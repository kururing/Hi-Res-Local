//! Render-endpoint enumeration and selection via `IMMDeviceEnumerator`.
//!
//! Does **not** auto-switch devices on disconnect — the caller keeps the
//! selected id and handles device-lost errors from the output thread.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Variant::VT_LPWSTR;

use crate::audio::dto::AudioDeviceDTO;
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::wasapi::format::FormatNegotiator;

/// Owns the preferred render device id and enumerates WASAPI endpoints.
pub struct WasapiDeviceManager {
    /// Endpoint id string from `IMMDevice::GetId`. `None` = system default.
    selected_device_id: Option<String>,
    /// Tracks whether this manager called `CoInitializeEx` successfully on
    /// the creating thread (best-effort; other threads call ensure_com).
    com_initialized_here: bool,
}

impl Default for WasapiDeviceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WasapiDeviceManager {
    pub fn new() -> Self {
        // Only uninit on Drop when *this* call performed the first CoInitializeEx.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let com_initialized_here = hr.is_ok() && hr.0 == 0;
        Self {
            selected_device_id: None,
            com_initialized_here,
        }
    }

    pub fn selected_device_id(&self) -> Option<&str> {
        self.selected_device_id.as_deref()
    }

    /// Select by WASAPI device id string. `None` / `"default"` restores the default endpoint.
    /// Does not open a stream and does not auto-failover on disconnect.
    pub fn select_device(&mut self, device_id: Option<String>) {
        self.selected_device_id = match device_id {
            Some(id) if id.is_empty() || id.eq_ignore_ascii_case("default") => None,
            other => other,
        };
    }

    /// Resolve selection to a real endpoint id (default → `GetDefaultAudioEndpoint` id).
    pub fn resolve_active_endpoint_id(&self) -> AudioResult<String> {
        let device = self.get_active_device()?;
        device_id_string(&device)
    }

    /// Read the hardware/endpoint master volume used by Windows for the selected output.
    pub fn endpoint_audio_state(&self) -> AudioResult<(f32, bool)> {
        let endpoint = endpoint_volume(&self.get_active_device()?)?;
        unsafe {
            let volume = endpoint.GetMasterVolumeLevelScalar().map_err(|e| {
                AudioError::DeviceUnavailable(format!("GetMasterVolumeLevelScalar failed: {e}"))
            })?;
            let muted = endpoint
                .GetMute()
                .map_err(|e| AudioError::DeviceUnavailable(format!("GetMute failed: {e}")))?
                .as_bool();
            Ok((volume.clamp(0.0, 1.0), muted))
        }
    }

    /// Set Windows endpoint volume without touching the decoded PCM samples.
    pub fn set_endpoint_volume(&self, volume: f32) -> AudioResult<()> {
        let endpoint = endpoint_volume(&self.get_active_device()?)?;
        unsafe {
            endpoint
                .SetMasterVolumeLevelScalar(volume.clamp(0.0, 1.0), std::ptr::null())
                .map_err(|e| {
                    AudioError::DeviceUnavailable(format!("SetMasterVolumeLevelScalar failed: {e}"))
                })
        }
    }

    /// Set Windows endpoint mute without applying software mute in the PCM pipeline.
    pub fn set_endpoint_muted(&self, muted: bool) -> AudioResult<()> {
        let endpoint = endpoint_volume(&self.get_active_device()?)?;
        unsafe {
            endpoint
                .SetMute(muted, std::ptr::null())
                .map_err(|e| AudioError::DeviceUnavailable(format!("SetMute failed: {e}")))
        }
    }

    /// Friendly name for the currently selected / default endpoint (for CPAL mapping).
    pub fn active_friendly_name(&self) -> AudioResult<String> {
        let device = self.get_active_device()?;
        device_friendly_name(&device).map_err(|e| {
            AudioError::DeviceUnavailable(format!(
                "Could not read friendly name for CPAL mapping: {e}"
            ))
        })
    }

    /// Map an endpoint id (or legacy friendly name) to CPAL-compatible friendly name.
    /// Returns `None` when the caller wants the system default.
    pub fn cpal_name_for_selection(device_id: Option<&str>) -> AudioResult<Option<String>> {
        match device_id {
            None | Some("") => Ok(None),
            Some(id) if id.eq_ignore_ascii_case("default") => Ok(None),
            Some(id) => {
                let mut mgr = Self::new();
                mgr.select_device(Some(id.to_string()));
                let name = mgr.active_friendly_name()?;
                tracing::info!(
                    target: "wasapi",
                    endpoint_or_name = %id,
                    cpal_name = %name,
                    "mapped selection to CPAL Shared device name"
                );
                Ok(Some(name))
            }
        }
    }

    pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
        ensure_com()?;
        let enumerator = create_enumerator()?;

        let default_id = unsafe {
            enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .ok()
                .and_then(|d| device_id_string(&d).ok())
        };

        let collection = unsafe {
            enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                .map_err(|e| {
                    AudioError::DeviceUnavailable(format!("EnumAudioEndpoints failed: {e}"))
                })?
        };

        let count = unsafe {
            collection
                .GetCount()
                .map_err(|e| AudioError::DeviceUnavailable(format!("GetCount failed: {e}")))?
        };

        let mut list = Vec::with_capacity(count as usize + 1);

        // Stable sentinel so Settings can always select "follow Windows default".
        let default_rates = vec![44_100, 48_000];
        let default_channels = vec![2u16];
        list.push(AudioDeviceDTO {
            id: "default".into(),
            name: "System default".into(),
            is_default: true,
            is_current: self.selected_device_id.is_none(),
            sample_rates: default_rates.clone(),
            channels: default_channels.clone(),
        });

        for i in 0..count {
            let device = unsafe {
                match collection.Item(i) {
                    Ok(d) => d,
                    Err(_) => continue,
                }
            };

            let id = match device_id_string(&device) {
                Ok(id) => id,
                Err(_) => continue,
            };
            let name = device_friendly_name(&device).unwrap_or_else(|_| id.clone());
            let is_default = default_id.as_deref() == Some(id.as_str());
            let is_current = match &self.selected_device_id {
                Some(sel) => sel == &id || sel == &name,
                None => false, // "default" sentinel is current when nothing pinned
            };

            let (sample_rates, channels, _bit_depths) =
                FormatNegotiator::probe_supported_cached(&device, &id).unwrap_or_else(|_| {
                    (
                        default_rates.clone(),
                        default_channels.clone(),
                        vec![16, 24, 32],
                    )
                });

            list.push(AudioDeviceDTO {
                id,
                name,
                is_default,
                is_current,
                sample_rates,
                channels,
            });
        }

        Ok(list)
    }

    /// Resolve the active `IMMDevice` (selected id, else default console render).
    pub fn get_active_device(&self) -> AudioResult<IMMDevice> {
        ensure_com()?;
        let enumerator = create_enumerator()?;

        if let Some(ref id) = self.selected_device_id {
            let wide = wide_null(id);
            if let Ok(device) = unsafe { enumerator.GetDevice(PCWSTR(wide.as_ptr())) } {
                tracing::info!(
                    target: "wasapi",
                    endpoint = %id,
                    "resolved render endpoint by id"
                );
                return Ok(device);
            }

            // Legacy selections may store CPAL friendly names. Accept either so
            // one output-device selection works in Shared and Exclusive.
            let collection = unsafe {
                enumerator
                    .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                    .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?
            };
            let count = unsafe {
                collection
                    .GetCount()
                    .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?
            };
            for index in 0..count {
                let Ok(device) = (unsafe { collection.Item(index) }) else {
                    continue;
                };
                if device_friendly_name(&device).is_ok_and(|name| {
                    name == id.as_str()
                        || name.eq_ignore_ascii_case(id)
                        || name.to_lowercase().contains(&id.to_lowercase())
                        || id.to_lowercase().contains(&name.to_lowercase())
                }) {
                    let resolved = device_id_string(&device).unwrap_or_else(|_| id.clone());
                    tracing::info!(
                        target: "wasapi",
                        friendly = %id,
                        endpoint = %resolved,
                        "resolved render endpoint by friendly name"
                    );
                    return Ok(device);
                }
            }
            return Err(AudioError::DeviceUnavailable(format!(
                "Audio endpoint not found: {id}"
            )));
        }

        unsafe {
            enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| {
                    AudioError::DeviceUnavailable(format!("No default render endpoint: {e}"))
                })
                .inspect(|device| {
                    if let Ok(id) = device_id_string(device) {
                        tracing::info!(
                            target: "wasapi",
                            endpoint = %id,
                            "resolved system default render endpoint"
                        );
                    }
                })
        }
    }
}

fn endpoint_volume(device: &IMMDevice) -> AudioResult<IAudioEndpointVolume> {
    unsafe {
        device.Activate(CLSCTX_ALL, None).map_err(|e| {
            AudioError::DeviceUnavailable(format!("IAudioEndpointVolume activation failed: {e}"))
        })
    }
}

impl Drop for WasapiDeviceManager {
    fn drop(&mut self) {
        if self.com_initialized_here {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

fn create_enumerator() -> AudioResult<IMMDeviceEnumerator> {
    unsafe {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| {
            AudioError::DeviceUnavailable(format!("MMDeviceEnumerator create failed: {e}"))
        })
    }
}

pub(crate) fn ensure_com() -> AudioResult<()> {
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    // S_OK (0) or S_FALSE (1) — already initialized on this thread.
    if hr.is_ok() || hr.0 == 1 {
        return Ok(());
    }
    // RPC_E_CHANGED_MODE (0x80010106): COM already initialized differently.
    if hr.0 as u32 == 0x8001_0106 {
        return Ok(());
    }
    Err(AudioError::StreamInitialization(format!(
        "CoInitializeEx failed: 0x{:08X}",
        hr.0 as u32
    )))
}

/// Initialize COM and return a guard that calls `CoUninitialize` only when this
/// call was the first init on the thread (`S_OK`).
pub(crate) fn ensure_com_guard() -> AudioResult<ComInitGuard> {
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_ok() && hr.0 == 0 {
        return Ok(ComInitGuard {
            should_uninit: true,
        });
    }
    if hr.0 == 1 || hr.0 as u32 == 0x8001_0106 {
        return Ok(ComInitGuard {
            should_uninit: false,
        });
    }
    Err(AudioError::StreamInitialization(format!(
        "CoInitializeEx failed: 0x{:08X}",
        hr.0 as u32
    )))
}

pub(crate) struct ComInitGuard {
    should_uninit: bool,
}

impl Drop for ComInitGuard {
    fn drop(&mut self) {
        if self.should_uninit {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

fn wide_null(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub(crate) fn device_id_string(device: &IMMDevice) -> AudioResult<String> {
    unsafe {
        let pwstr: PWSTR = device
            .GetId()
            .map_err(|e| AudioError::DeviceUnavailable(format!("IMMDevice::GetId failed: {e}")))?;
        let id = pwstr
            .to_string()
            .map_err(|e| AudioError::DeviceUnavailable(format!("device id utf16: {e}")))?;
        CoTaskMemFree(Some(pwstr.0 as _));
        Ok(id)
    }
}

pub(crate) fn device_friendly_name(device: &IMMDevice) -> AudioResult<String> {
    unsafe {
        let store = device
            .OpenPropertyStore(STGM_READ)
            .map_err(|e| AudioError::DeviceUnavailable(format!("OpenPropertyStore failed: {e}")))?;
        let mut prop = store.GetValue(&PKEY_Device_FriendlyName).map_err(|e| {
            AudioError::DeviceUnavailable(format!("PKEY_Device_FriendlyName failed: {e}"))
        })?;

        let name = {
            let inner = &prop.Anonymous.Anonymous;
            if inner.vt != VT_LPWSTR {
                let _ = PropVariantClear(&mut prop);
                return Err(AudioError::DeviceUnavailable(
                    "FriendlyName PROPVARIANT is not VT_LPWSTR".into(),
                ));
            }
            let pwstr = inner.Anonymous.pwszVal;
            pwstr
                .to_string()
                .map_err(|e| AudioError::DeviceUnavailable(format!("friendly name utf16: {e}")))?
        };

        let _ = PropVariantClear(&mut prop);
        Ok(name)
    }
}

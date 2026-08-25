use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, Host, SupportedStreamConfig};

use crate::audio::dto::AudioDeviceDTO;
use crate::audio::error::{AudioError, AudioResult};

pub struct OutputDeviceManager {
    host: Host,
    selected_device_name: Option<String>,
}

impl Default for OutputDeviceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl OutputDeviceManager {
    pub fn new() -> Self {
        Self {
            host: cpal::default_host(),
            selected_device_name: None,
        }
    }

    pub fn enumerate_devices(&self) -> AudioResult<Vec<AudioDeviceDTO>> {
        let default_device_name = self
            .host
            .default_output_device()
            .and_then(|d| d.name().ok());

        let devices = self
            .host
            .output_devices()
            .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;

        let mut list = Vec::new();

        for dev in devices {
            if let Ok(name) = dev.name() {
                let is_default = default_device_name.as_deref() == Some(&name);
                let is_current = match &self.selected_device_name {
                    Some(cur) => names_match(cur, &name),
                    None => is_default,
                };

                let mut sample_rates = Vec::new();
                let mut channels = Vec::new();

                if let Ok(configs) = dev.supported_output_configs() {
                    for cfg in configs {
                        let min_sr = cfg.min_sample_rate().0;
                        let max_sr = cfg.max_sample_rate().0;
                        let ch = cfg.channels();

                        if !channels.contains(&ch) {
                            channels.push(ch);
                        }

                        for sr in [44100, 48000, 88200, 96000, 192000] {
                            if sr >= min_sr && sr <= max_sr && !sample_rates.contains(&sr) {
                                sample_rates.push(sr);
                            }
                        }
                    }
                }

                sample_rates.sort_unstable();
                channels.sort_unstable();

                list.push(AudioDeviceDTO {
                    id: name.clone(),
                    name,
                    is_default,
                    is_current,
                    sample_rates,
                    channels,
                });
            }
        }

        Ok(list)
    }

    pub fn select_device(&mut self, device_name: Option<String>) {
        self.selected_device_name = match device_name {
            Some(name) if name.is_empty() || name.eq_ignore_ascii_case("default") => None,
            other => other,
        };
    }

    pub fn selected_device_name(&self) -> Option<&str> {
        self.selected_device_name.as_deref()
    }

    /// Resolve the selected CPAL device.
    ///
    /// When a specific device is selected and cannot be found, returns an error
    /// instead of silently falling back to the system default.
    pub fn get_active_device(&self) -> AudioResult<Device> {
        if let Some(ref name) = self.selected_device_name {
            if let Some(device) = self.find_device_by_name(name)? {
                tracing::info!(
                    target: "audio",
                    device = %name,
                    "CPAL Shared using selected output device"
                );
                return Ok(device);
            }
            return Err(AudioError::DeviceUnavailable(format!(
                "Output device not found in CPAL host: {name}"
            )));
        }

        self.host.default_output_device().ok_or_else(|| {
            AudioError::DeviceUnavailable("No default output audio device found".to_string())
        })
    }

    fn find_device_by_name(&self, wanted: &str) -> AudioResult<Option<Device>> {
        let devices = self
            .host
            .output_devices()
            .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;

        let mut fallback: Option<Device> = None;
        for dev in devices {
            let Ok(dev_name) = dev.name() else {
                continue;
            };
            if names_match(&dev_name, wanted) {
                return Ok(Some(dev));
            }
            // Soft match: CPAL name contains WASAPI name or vice versa.
            if fallback.is_none() && names_soft_match(&dev_name, wanted) {
                fallback = Some(dev);
            }
        }
        Ok(fallback)
    }

    pub fn get_best_output_config(device: &Device) -> AudioResult<SupportedStreamConfig> {
        device
            .default_output_config()
            .map_err(|e| AudioError::StreamInitialization(e.to_string()))
    }
}

fn names_match(a: &str, b: &str) -> bool {
    a.trim() == b.trim() || a.trim().eq_ignore_ascii_case(b.trim())
}

fn names_soft_match(a: &str, b: &str) -> bool {
    let a = a.trim().to_lowercase();
    let b = b.trim().to_lowercase();
    !a.is_empty() && !b.is_empty() && (a.contains(&b) || b.contains(&a))
}

/// Sample format conversion helpers
#[inline(always)]
pub fn convert_f32_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped >= 1.0 {
        i16::MAX
    } else if clamped <= -1.0 {
        i16::MIN
    } else {
        (clamped * 32767.0) as i16
    }
}

#[inline(always)]
pub fn convert_f32_to_u16(sample: f32) -> u16 {
    let clamped = sample.clamp(-1.0, 1.0);
    let normalized = (clamped * 0.5) + 0.5;
    (normalized * 65535.0) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sample_conversions() {
        assert_eq!(convert_f32_to_i16(0.0), 0);
        assert_eq!(convert_f32_to_i16(1.0), i16::MAX);
        assert_eq!(convert_f32_to_i16(-1.0), i16::MIN);
        assert_eq!(convert_f32_to_i16(1.5), i16::MAX);
        assert_eq!(convert_f32_to_i16(-1.5), i16::MIN);

        assert_eq!(convert_f32_to_u16(0.0), 32767);
        assert_eq!(convert_f32_to_u16(1.0), 65535);
        assert_eq!(convert_f32_to_u16(-1.0), 0);
    }

    #[test]
    fn names_match_trims_and_ignores_case() {
        assert!(names_match(" Speakers ", "speakers"));
        assert!(!names_match("A", "B"));
    }

    #[test]
    fn select_default_clears_pinned_device() {
        let mut mgr = OutputDeviceManager::new();
        mgr.select_device(Some("Speakers".into()));
        assert_eq!(mgr.selected_device_name(), Some("Speakers"));
        mgr.select_device(Some("default".into()));
        assert_eq!(mgr.selected_device_name(), None);
    }
}

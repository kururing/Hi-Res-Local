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
                    Some(cur) => cur == &name,
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
        self.selected_device_name = device_name;
    }

    pub fn get_active_device(&self) -> AudioResult<Device> {
        if let Some(ref name) = self.selected_device_name {
            let devices = self
                .host
                .output_devices()
                .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;

            for dev in devices {
                if let Ok(dev_name) = dev.name() {
                    if dev_name == *name {
                        return Ok(dev);
                    }
                }
            }
        }

        self.host.default_output_device().ok_or_else(|| {
            AudioError::DeviceUnavailable("No default output audio device found".to_string())
        })
    }

    pub fn get_best_output_config(device: &Device) -> AudioResult<SupportedStreamConfig> {
        device
            .default_output_config()
            .map_err(|e| AudioError::StreamInitialization(e.to_string()))
    }
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
}

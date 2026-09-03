use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::engine::EngineKind;
use crate::error::CoreResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioToml {
    #[serde(default)]
    pub audio_engine: AudioEngineSection,
    #[serde(default)]
    pub audio_output: AudioOutputSection,
    #[serde(default)]
    pub dsp: DspSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioEngineSection {
    #[serde(default = "default_engine")]
    pub engine: String,
    #[serde(default)]
    pub bitperfect_by_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioOutputSection {
    #[serde(default = "default_device")]
    pub default_device: String,
    #[serde(default)]
    pub exclusive_mode: bool,
    #[serde(default = "default_dsd_mode")]
    pub dsd_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DspSection {
    #[serde(default)]
    pub eq_enabled: bool,
    #[serde(default)]
    pub replaygain_enabled: bool,
}

impl Default for AudioEngineSection {
    fn default() -> Self {
        Self {
            engine: default_engine(),
            bitperfect_by_default: false,
        }
    }
}

impl Default for AudioOutputSection {
    fn default() -> Self {
        Self {
            default_device: default_device(),
            exclusive_mode: false,
            dsd_mode: default_dsd_mode(),
        }
    }
}

impl Default for DspSection {
    fn default() -> Self {
        Self {
            eq_enabled: false,
            replaygain_enabled: false,
        }
    }
}

impl Default for AudioToml {
    fn default() -> Self {
        Self {
            audio_engine: AudioEngineSection::default(),
            audio_output: AudioOutputSection::default(),
            dsp: DspSection::default(),
        }
    }
}

fn default_engine() -> String {
    "rust".into()
}
fn default_device() -> String {
    "default".into()
}
fn default_dsd_mode() -> String {
    "pcm".into()
}

impl AudioToml {
    pub fn engine_kind(&self) -> EngineKind {
        EngineKind::parse(&self.audio_engine.engine)
    }

    pub fn load_or_default(path: &Path) -> CoreResult<Self> {
        if !path.is_file() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(path)?;
        Self::parse(&text)
    }

    pub fn parse(text: &str) -> CoreResult<Self> {
        toml::from_str(text).map_err(|e| crate::error::CoreError::Probe(format!("audio.toml: {e}")))
    }

    /// Map onto the existing desktop AppSettings field names.
    pub fn to_settings_patch(&self) -> SettingsPatch {
        SettingsPatch {
            audio_engine: self.engine_kind().as_str().to_string(),
            bit_perfect: self.audio_engine.bitperfect_by_default,
            output_device: self.audio_output.default_device.clone(),
            wasapi_exclusive: self.audio_output.exclusive_mode,
            dsd_output_mode: self.audio_output.dsd_mode.clone(),
            eq_enabled: self.dsp.eq_enabled,
            replay_gain_mode: if self.dsp.replaygain_enabled {
                "track".into()
            } else {
                "off".into()
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsPatch {
    pub audio_engine: String,
    pub bit_perfect: bool,
    pub output_device: String,
    pub wasapi_exclusive: bool,
    pub dsd_output_mode: String,
    pub eq_enabled: bool,
    pub replay_gain_mode: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shipped_defaults_do_not_occupy_dac() {
        let cfg = AudioToml::parse(
            r#"
[audio_engine]
engine = "hybrid"
bitperfect_by_default = false
[audio_output]
default_device = "default"
exclusive_mode = false
dsd_mode = "pcm"
[dsp]
eq_enabled = false
replaygain_enabled = false
"#,
        )
        .unwrap();
        assert!(!cfg.audio_engine.bitperfect_by_default);
        assert!(!cfg.audio_output.exclusive_mode);
        assert_eq!(cfg.audio_output.dsd_mode, "pcm");
        let patch = cfg.to_settings_patch();
        assert_eq!(patch.wasapi_exclusive, false);
        assert_eq!(patch.dsd_output_mode, "pcm");
    }
}

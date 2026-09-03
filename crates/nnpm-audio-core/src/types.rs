use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DsdRate {
    Dsd64,
    Dsd128,
    Dsd256,
    Dsd512,
    Dsd1024,
}

impl DsdRate {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Dsd64 => "DSD64",
            Self::Dsd128 => "DSD128",
            Self::Dsd256 => "DSD256",
            Self::Dsd512 => "DSD512",
            Self::Dsd1024 => "DSD1024",
        }
    }

    pub const fn multiplier(self) -> u32 {
        match self {
            Self::Dsd64 => 64,
            Self::Dsd128 => 128,
            Self::Dsd256 => 256,
            Self::Dsd512 => 512,
            Self::Dsd1024 => 1024,
        }
    }

    pub const fn sample_rate_hz(self) -> u32 {
        44_100 * self.multiplier()
    }

    pub const fn sample_rate_hz_48(self) -> u32 {
        48_000 * self.multiplier()
    }

    pub const fn dop_supported(self) -> bool {
        matches!(self, Self::Dsd64 | Self::Dsd128 | Self::Dsd256)
    }

    pub const fn dop_pcm_rate(self) -> Option<u32> {
        if self.dop_supported() {
            Some(self.sample_rate_hz() / 16)
        } else {
            None
        }
    }

    pub const ALL: [Self; 5] = [
        Self::Dsd64,
        Self::Dsd128,
        Self::Dsd256,
        Self::Dsd512,
        Self::Dsd1024,
    ];

    pub const ADVERTISED_DOP: [Self; 3] = [Self::Dsd64, Self::Dsd128, Self::Dsd256];
}

pub fn dsd_rate_from_sample_rate(sample_rate: u32) -> Option<DsdRate> {
    for rate in DsdRate::ALL {
        if sample_rate == rate.sample_rate_hz() || sample_rate == rate.sample_rate_hz_48() {
            return Some(rate);
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PcmFormat {
    S16,
    S24,
    S32,
    F32,
    F64,
}

/// Actual sample type of the last decoded Symphonia buffer (planar internally).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecodedSampleRepr {
    #[default]
    Unknown,
    S8,
    S16,
    S24,
    S32,
    U8,
    U16,
    U24,
    U32,
    F32,
    F64,
}

impl DecodedSampleRepr {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::S8 => "s8",
            Self::S16 => "s16",
            Self::S24 => "s24",
            Self::S32 => "s32",
            Self::U8 => "u8",
            Self::U16 => "u16",
            Self::U24 => "u24",
            Self::U32 => "u32",
            Self::F32 => "f32",
            Self::F64 => "f64",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioInfo {
    pub container: String,
    pub codec: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub bit_depth: Option<u16>,
    pub channels: u16,
    pub channel_layout: Option<String>,
    pub bitrate_kbps: Option<u32>,
    pub lossless: bool,
    pub hi_res: bool,
    pub dsd_rate: Option<DsdRate>,
    pub lsb_first: bool,
}

impl AudioInfo {
    pub fn is_dsd(&self) -> bool {
        self.dsd_rate.is_some()
            || self.codec.eq_ignore_ascii_case("dsd")
            || self.codec.eq_ignore_ascii_case("dst")
    }
}

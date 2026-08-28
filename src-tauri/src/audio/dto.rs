use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DsdOutputMode {
    NativeDsd,
    Dop,
    #[default]
    Pcm,
}

impl DsdOutputMode {
    /// Stable index for lock-free storage in an `AtomicU32`.
    pub const fn to_index(self) -> u32 {
        match self {
            Self::NativeDsd => 0,
            Self::Dop => 1,
            Self::Pcm => 2,
        }
    }

    pub const fn from_index(index: u32) -> Self {
        match index {
            0 => Self::NativeDsd,
            1 => Self::Dop,
            _ => Self::Pcm,
        }
    }
}

/// User-facing playback mode. Decoupled from the actual backend
/// ([`AudioBackend`]) and the DSD transport ([`DsdOutputMode`]) which are
/// resolved at runtime per track.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum PlaybackMode {
    #[default]
    Auto,
    HighQuality,
    Multitask,
    Advanced,
}

impl PlaybackMode {
    /// Stable index for lock-free storage in an `AtomicU32`.
    pub const fn to_index(self) -> u32 {
        match self {
            Self::Auto => 0,
            Self::HighQuality => 1,
            Self::Multitask => 2,
            Self::Advanced => 3,
        }
    }

    pub const fn from_index(index: u32) -> Self {
        match index {
            1 => Self::HighQuality,
            2 => Self::Multitask,
            3 => Self::Advanced,
            _ => Self::Auto,
        }
    }
}

/// Where the audible volume control actually lives. Never `Analog`:
/// no backend in this stack can verify an analog attenuator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum VolumeControlKind {
    /// Windows endpoint (device) volume — bit-perfect / DoP / native DSD paths.
    WindowsEndpoint,
    /// Software gain applied in the decode pipeline.
    #[default]
    Software,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioBackend {
    #[default]
    Shared,
    WasapiExclusive,
    Asio,
}

impl AudioBackend {
    /// Stable index for lock-free storage in an `AtomicU32`.
    pub const fn to_index(self) -> u32 {
        match self {
            Self::Shared => 0,
            Self::WasapiExclusive => 1,
            Self::Asio => 2,
        }
    }

    pub const fn from_index(index: u32) -> Self {
        match index {
            1 => Self::WasapiExclusive,
            2 => Self::Asio,
            _ => Self::Shared,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DsdRate {
    Dsd64,
    Dsd128,
    Dsd256,
    Dsd512,
}

impl DsdRate {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Dsd64 => "DSD64",
            Self::Dsd128 => "DSD128",
            Self::Dsd256 => "DSD256",
            Self::Dsd512 => "DSD512",
        }
    }

    pub const fn multiplier(self) -> u32 {
        match self {
            Self::Dsd64 => 64,
            Self::Dsd128 => 128,
            Self::Dsd256 => 256,
            Self::Dsd512 => 512,
        }
    }

    /// DSD bit rate in Hz (44.1 kHz × multiplier).
    pub const fn sample_rate_hz(self) -> u32 {
        44_100 * self.multiplier()
    }

    /// DSD bit rate in Hz (48 kHz × multiplier).
    pub const fn sample_rate_hz_48(self) -> u32 {
        48_000 * self.multiplier()
    }

    /// Both 44.1 kHz and 48 kHz DSD families for this rate label.
    pub const fn sample_rate_families_hz(self) -> [u32; 2] {
        [self.sample_rate_hz(), self.sample_rate_hz_48()]
    }

    /// PCM frame rate of the DoP encapsulation for this DSD rate
    /// (16 DSD bits per 24-bit DoP sample): DSD64 → 176.4 kHz.
    pub const fn dop_pcm_rate(self) -> u32 {
        self.sample_rate_hz() / 16
    }

    /// DoP PCM frame rate for the 48 kHz DSD family: DSD64 → 192 kHz.
    pub const fn dop_pcm_rate_48(self) -> u32 {
        self.sample_rate_hz_48() / 16
    }

    /// DoP PCM rates for both DSD families.
    pub const fn dop_pcm_rates(self) -> [u32; 2] {
        [self.dop_pcm_rate(), self.dop_pcm_rate_48()]
    }

    pub const ALL: [Self; 4] = [Self::Dsd64, Self::Dsd128, Self::Dsd256, Self::Dsd512];

    /// Rates advertised from a WASAPI Exclusive PCM probe. Each rate is only
    /// exposed when the endpoint accepts the exact 24-bit DoP carrier rate.
    pub const ADVERTISED_DOP: [Self; 4] = Self::ALL;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum PlaybackState {
    #[default]
    Stopped,
    Playing,
    Paused,
    Buffering,
    Ended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum RepeatMode {
    #[default]
    Off,
    One,
    All,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ReplayGainInfo {
    pub track_gain_db: Option<f32>,
    pub track_peak: Option<f32>,
    pub album_gain_db: Option<f32>,
    pub album_peak: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ReplayGainMode {
    Off,
    #[default]
    Track,
    Album,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReplayGainConfig {
    pub mode: ReplayGainMode,
    pub preamp_db: f32,
    pub prevent_clipping: bool,
    pub fallback_gain_db: f32,
}

impl Default for ReplayGainConfig {
    fn default() -> Self {
        Self {
            mode: ReplayGainMode::Track,
            preamp_db: 0.0,
            prevent_clipping: true,
            fallback_gain_db: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioTrack {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub track_number: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub replay_gain: Option<ReplayGainInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QualityBadge {
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub codec_name: String,
    pub container_format: String,
    pub is_lossless: bool,
    pub is_hi_res: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsd_rate: Option<DsdRate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsd_output_mode: Option<DsdOutputMode>,
}

impl QualityBadge {
    pub fn compute_is_hi_res(sample_rate: u32, bit_depth: Option<u32>) -> bool {
        sample_rate >= 88_200 || bit_depth.unwrap_or(16) > 16
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum EqPreset {
    #[default]
    Flat,
    BassBoost,
    TrebleBoost,
    Vocal,
    Rock,
    Pop,
    Jazz,
    Electronic,
    Classical,
    Acoustic,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EqBand {
    pub index: usize,
    pub freq_hz: f32,
    pub gain_db: f32,
    pub q: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EqConfig {
    pub enabled: bool,
    pub preset: EqPreset,
    pub bands: Vec<EqBand>,
}

impl Default for EqConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: EqPreset::Flat,
            bands: Self::default_10_bands(),
        }
    }
}

impl EqConfig {
    pub const FREQUENCIES_10_BAND: [f32; 10] = [
        31.25, 62.5, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
    ];

    pub fn default_10_bands() -> Vec<EqBand> {
        Self::FREQUENCIES_10_BAND
            .iter()
            .enumerate()
            .map(|(index, &freq_hz)| EqBand {
                index,
                freq_hz,
                gain_db: 0.0,
                q: 1.414,
            })
            .collect()
    }

    pub fn preset_gains(preset: EqPreset) -> [f32; 10] {
        match preset {
            EqPreset::Flat => [0.0; 10],
            EqPreset::BassBoost => [5.0, 4.5, 3.5, 2.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0],
            EqPreset::TrebleBoost => [0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 3.0, 4.5, 5.5, 6.0],
            EqPreset::Vocal => [-1.5, -1.0, 0.0, 2.0, 3.5, 3.5, 2.5, 1.0, 0.0, -1.0],
            EqPreset::Rock => [4.0, 3.0, 1.5, 0.0, -1.0, -0.5, 1.5, 3.0, 4.0, 4.5],
            EqPreset::Pop => [-1.0, 1.0, 2.5, 3.0, 2.0, 0.0, -1.0, -1.0, 1.5, 2.5],
            EqPreset::Jazz => [3.0, 2.0, 1.0, 1.5, -1.0, -1.0, 0.0, 1.5, 2.5, 3.0],
            EqPreset::Electronic => [4.5, 4.0, 1.5, 0.0, -1.5, 1.0, 0.5, 2.0, 3.5, 4.0],
            EqPreset::Classical => [4.0, 3.0, 2.5, 2.0, -1.0, -1.0, 0.0, 2.0, 3.0, 3.5],
            EqPreset::Acoustic => [3.5, 2.5, 1.5, 1.0, 1.0, 1.0, 1.5, 2.5, 3.0, 2.5],
            EqPreset::Custom => [0.0; 10],
        }
    }

    pub fn apply_preset(&mut self, preset: EqPreset) {
        self.preset = preset;
        if preset != EqPreset::Custom {
            let gains = Self::preset_gains(preset);
            for (band, gain) in self.bands.iter_mut().zip(gains.iter()) {
                band.gain_db = *gain;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum CrossfadeCurve {
    Linear,
    #[default]
    EqualPower,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CrossfadeConfig {
    pub enabled: bool,
    pub duration_ms: u64,
    pub curve: CrossfadeCurve,
}

impl Default for CrossfadeConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            duration_ms: 2500,
            curve: CrossfadeCurve::EqualPower,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioDeviceDTO {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub is_current: bool,
    pub sample_rates: Vec<u32>,
    #[serde(default)]
    pub bit_depths: Vec<u32>,
    pub channels: Vec<u16>,
    #[serde(default)]
    pub backend: AudioBackend,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asio_driver_id: Option<String>,
    #[serde(default)]
    pub native_dsd_supported: bool,
    #[serde(default)]
    pub dsd_rates: Vec<DsdRate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AsioDriverDTO {
    pub id: String,
    pub name: String,
    pub native_dsd_supported: bool,
    pub dsd_rates: Vec<DsdRate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaybackProgress {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub buffered_ms: u64,
    pub percentage: f32,
}

impl Default for PlaybackProgress {
    fn default() -> Self {
        Self {
            position_ms: 0,
            duration_ms: 0,
            buffered_ms: 0,
            percentage: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineStatus {
    pub output_mode: String,
    /// True only when the wire is bit-perfect AND every DSP stage
    /// (EQ / ReplayGain / crossfade / software volume) is bypassed.
    pub bit_perfect: bool,
    pub is_native: bool,
    pub output_sample_rate: u32,
    pub output_bit_depth: u32,
    pub source_label: String,
    #[serde(default)]
    pub backend: AudioBackend,
    #[serde(default)]
    pub dsd_output_mode: DsdOutputMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsd_rate: Option<DsdRate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_dsd_error: Option<String>,
    /// Human label of the source, e.g. `"DSD128"` or `"FLAC 24-bit / 96 kHz"`.
    #[serde(default)]
    pub source_format: String,
    #[serde(default)]
    pub source_sample_rate: u32,
    /// 1 for DSD sources.
    #[serde(default)]
    pub source_bit_depth: u32,
    /// How DSD reaches the device; `None` for PCM sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsd_transport: Option<DsdOutputMode>,
    /// Human label of what is sent to the device,
    /// e.g. `"PCM 24-bit / 352.8 kHz (DoP)"` or `"DSD 5.6 MHz (Native)"`.
    #[serde(default)]
    pub output_format: String,
    #[serde(default)]
    pub volume: f32,
    #[serde(default)]
    pub volume_control_kind: VolumeControlKind,
    /// Set when Auto/High-Quality fell back from a better path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            output_mode: "WASAPI Shared".into(),
            bit_perfect: false,
            is_native: false,
            output_sample_rate: 0,
            output_bit_depth: 32,
            source_label: String::new(),
            backend: AudioBackend::Shared,
            dsd_output_mode: DsdOutputMode::Pcm,
            dsd_rate: None,
            native_dsd_error: None,
            source_format: String::new(),
            source_sample_rate: 0,
            source_bit_depth: 0,
            dsd_transport: None,
            output_format: String::new(),
            volume: 1.0,
            volume_control_kind: VolumeControlKind::Software,
            fallback_reason: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SystemAudioState {
    pub volume: f32,
    pub is_muted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerSnapshot {
    pub state: PlaybackState,
    pub current_track: Option<AudioTrack>,
    pub progress: PlaybackProgress,
    pub volume: f32,
    pub is_muted: bool,
    pub repeat_mode: RepeatMode,
    pub shuffle_enabled: bool,
    pub queue: Vec<AudioTrack>,
    pub queue_index: Option<usize>,
    pub quality_badge: Option<QualityBadge>,
    pub eq: EqConfig,
    pub crossfade: CrossfadeConfig,
    pub replay_gain: ReplayGainConfig,
    pub output_device: Option<AudioDeviceDTO>,
    pub engine_status: Option<EngineStatus>,
    pub bit_perfect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum AudioEvent {
    StateChanged(PlaybackState),
    TrackChanged(Option<AudioTrack>),
    /// The decode thread moved to the preloaded next track (gapless/crossfade).
    /// The player must advance its queue index and preload the following track.
    TrackTransitioned(AudioTrack),
    ProgressUpdated(PlaybackProgress),
    VolumeChanged {
        volume: f32,
        is_muted: bool,
    },
    QueueUpdated {
        queue: Vec<AudioTrack>,
        current_index: Option<usize>,
    },
    RepeatModeChanged(RepeatMode),
    ShuffleChanged(bool),
    QualityUpdated(Option<QualityBadge>),
    EngineStatusUpdated(EngineStatus),
    ExclusiveModeChanged {
        enabled: bool,
        output_mode: String,
        error: Option<String>,
    },
    NativeDsdStatus {
        active: bool,
        dsd_rate: Option<DsdRate>,
        error: Option<String>,
    },
    DeviceLost(String),
    ErrorOccurred(String),
}

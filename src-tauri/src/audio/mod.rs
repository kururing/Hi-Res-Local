//! Native Local Audio Subsystem for Nghe Nhac Pro Max (Tauri Backend)
//!
//! Provides a production-grade, local-only audio player architecture featuring:
//! - Exact sample seeking and playback state machine (Play/Pause/Stop/Seek/Resume)
//! - Queue management (CRUD, Reorder, Play Next, Repeat Off/One/All)
//! - Playback history stack & forward navigation
//! - Weighted shuffle algorithm with recent history penalty
//! - Symphonia 0.5 decoding for MP3, FLAC, WAV, OGG, AAC, ALAC, M4A
//! - CPAL 0.15 multi-device enumeration, device selection, sample conversion, and device lost recovery
//! - Gapless playback engine with background preloading
//! - Configurable crossfader (Linear & Equal Power)
//! - ReplayGain tags extraction (Track / Album / Peak Limiter)
//! - 10-band and custom parametric PCM Equalizer (Biquad peaking filters)
//! - Real-time technical quality badge info (Lossless, Hi-Res, Sample Rate, Bit Depth, Codec)
//! - High-precision progress events and snapshot state broadcaster
//! - Non-blocking command channel design for UI thread safety
//! - Bit-perfect exclusive mode and OS Media Controls (Windows SMTC, macOS Now Playing, MPRIS) adapters with fallback.

pub mod adapters;
mod control;
pub mod decoder;
pub mod device;
pub mod dsp;
pub mod dto;
pub mod error;
pub mod gapless;
pub mod pipeline;
pub mod player;
pub mod queue;

pub use adapters::{
    ExclusiveAudioAdapter, FallbackMediaControlsAdapter, MediaControlAction, MediaControlsAdapter,
    StandardAudioAdapter,
};
pub use decoder::{parse_db_string, AudioDecoder};
pub use device::{convert_f32_to_i16, convert_f32_to_u16, OutputDeviceManager};
pub use dsp::{
    soft_limit, BiquadFilter, CrossfadeProcessor, EqualizerProcessor, ReplayGainProcessor,
};
pub use dto::{
    AudioDeviceDTO, AudioEvent, AudioTrack, CrossfadeConfig, CrossfadeCurve, EqBand, EqConfig,
    EqPreset, PlaybackProgress, PlaybackState, PlayerSnapshot, QualityBadge, RepeatMode,
    ReplayGainConfig, ReplayGainInfo, ReplayGainMode,
};
pub use error::{AudioError, AudioResult};
pub use gapless::{GaplessController, LinearResampler, PreloadedTrack};
pub use player::{AudioCommand, AudioPlayer};
pub use queue::PlaybackQueue;

#[cfg(test)]
mod tests;

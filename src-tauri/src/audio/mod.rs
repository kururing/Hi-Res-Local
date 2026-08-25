//! Native Local Audio Subsystem for Nghe Nhac Pro Max (Tauri Backend)
//!
//! Windows path: **FFmpeg decode → PCM ring → WASAPI Exclusive → DAC**
//! - Auto sample-rate switching per track (exclusive re-init)
//! - Bit-perfect mode disables EQ / ReplayGain / software volume / resampling
//! - Non-Windows keeps CPAL shared output for compile compatibility
//!
//! Also: queue, gapless preload, EQ, ReplayGain, crossfade, quality / engine status IPC.

pub mod adapters;
mod control;
pub mod decoder;
pub mod device;
pub mod dsp;
pub mod dto;
pub mod engine;
pub mod error;
pub mod gapless;
pub mod pcm;
pub mod pcm_convert;
pub mod pcm_ring;
pub mod pipeline;
pub mod player;
pub mod queue;

#[cfg(windows)]
pub mod wasapi;

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
    AudioDeviceDTO, AudioEvent, AudioTrack, CrossfadeConfig, CrossfadeCurve, EngineStatus, EqBand,
    EqConfig, EqPreset, PlaybackProgress, PlaybackState, PlayerSnapshot, QualityBadge, RepeatMode,
    ReplayGainConfig, ReplayGainInfo, ReplayGainMode, SystemAudioState,
};
pub use error::{AudioError, AudioResult};
pub use gapless::{GaplessController, LinearResampler, PreloadedTrack};
pub use pcm::{format_sample_rate_khz, AudioFormat, PcmSampleFormat};
pub use pcm_convert::{
    f32_to_pcm_bytes, pack_container4_to_packed_s24, pack_packed_s24_to_container4,
    pcm_bytes_to_f32,
};
pub use pcm_ring::{PcmRing, PcmRingConsumer, PcmRingProducer, PCM_RING_MS};
pub use player::{AudioCommand, AudioPlayer};
pub use queue::PlaybackQueue;

#[cfg(windows)]
pub use wasapi::{
    FormatNegotiator, HeldWaveFormat, NegotiatedFormat, WasapiDeviceManager, WasapiExclusiveOutput,
    WasapiShareMode,
};

#[cfg(test)]
mod tests;

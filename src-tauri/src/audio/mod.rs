//! Native Local Audio Subsystem for Nghe Nhac Pro Max (Tauri Backend)
//!
//! Windows path: **nnpm-audio-core decode → PCM ring → WASAPI Exclusive → DAC**
//! - Auto sample-rate switching per track (exclusive re-init)
//! - Bit-perfect mode disables EQ / ReplayGain / software volume / resampling
//! - Non-Windows keeps CPAL shared output for compile compatibility
//!
//! Also: queue, gapless preload, EQ, ReplayGain, crossfade, quality / engine status IPC.

pub mod adapters;
pub mod asio;
#[cfg(windows)]
mod asio_bridge_ffi {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Default)]
    pub struct NgAsioInfo {
        pub output_channels: i32,
        pub bytes_per_channel: i32,
        pub sample_type: i32,
        pub sample_rate_hz: i32,
    }

    pub type NgAsioFillFn = unsafe extern "C" fn(
        user: *mut c_void,
        channel_buffers: *mut *mut c_void,
        channel_count: i32,
        bytes_per_channel: i32,
    );
    pub type NgAsioStatusFn = unsafe extern "C" fn(user: *mut c_void, code: i32);

    unsafe extern "C" {
        pub fn ng_asio_open_native(
            driver_name: *const i8,
            sample_rate_hz: f64,
            requested_channels: i32,
            fill: Option<NgAsioFillFn>,
            status: Option<NgAsioStatusFn>,
            user: *mut c_void,
            out_info: *mut NgAsioInfo,
            error: *mut i8,
            error_capacity: i32,
        ) -> *mut c_void;
        pub fn ng_asio_probe_native(
            driver_name: *const i8,
            sample_rate_hz: f64,
            sample_type: *mut i32,
            error: *mut i8,
            error_capacity: i32,
        ) -> i32;
        pub fn ng_asio_start(session: *mut c_void, error: *mut i8, error_capacity: i32) -> i32;
        pub fn ng_asio_stop(session: *mut c_void, error: *mut i8, error_capacity: i32) -> i32;
        pub fn ng_asio_close(session: *mut c_void);
    }
}
mod control;
pub mod decoder;
pub mod device;
pub mod dop;
pub mod dsd;
pub mod dsp;
pub mod dto;
pub mod engine;
pub mod error;
pub mod gapless;
pub mod http_input;
pub mod pcm;
pub mod pcm_convert;
pub mod pcm_ring;
pub mod pipeline;
pub mod player;
pub mod queue;
pub mod toml_config;

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
    AsioDriverDTO, AudioBackend, AudioDeviceDTO, AudioEvent, AudioTrack, CrossfadeConfig,
    CrossfadeCurve, DsdOutputMode, DsdRate, EngineStatus, EqBand, EqConfig, EqPreset, PlaybackMode,
    PlaybackProgress, PlaybackState, PlayerSnapshot, QualityBadge, RepeatMode, ReplayGainConfig,
    ReplayGainInfo, ReplayGainMode, SystemAudioState, VolumeControlKind,
};
pub use error::{AudioError, AudioResult};
pub use gapless::{GaplessController, LinearResampler, PreloadedTrack};
pub use pcm::{format_sample_rate_khz, frame_aligned_len, AudioFormat, PcmSampleFormat};
pub use pcm_convert::{
    f32_to_pcm_bytes, i16_to_pcm16_le, pack_container4_to_packed_s24,
    pack_packed_s24_to_container4, pack_s32_le_left_justified_to_s16, pcm_bytes_to_f32,
    synthetic_stereo_pcm, ChannelIdentityPattern,
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

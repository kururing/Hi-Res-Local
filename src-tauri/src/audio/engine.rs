//! High-level audio engine facade.
//!
//! Concrete playback is owned by [`crate::audio::player::AudioPlayer`]:
//! - Decode: [`crate::audio::decoder::AudioDecoder`] (FFmpeg)
//! - Ring: [`crate::audio::pcm_ring::PcmRing`]
//! - Output (Windows): [`crate::audio::wasapi::WasapiExclusiveOutput`]
//! - Devices / negotiate: [`crate::audio::wasapi::WasapiDeviceManager`] +
//!   [`crate::audio::wasapi::FormatNegotiator`]

/// Marker type documenting the FFmpeg → ring → WASAPI Exclusive pipeline.
pub struct AudioEngine;

impl AudioEngine {
    pub const OUTPUT_MODE_WASAPI_EXCLUSIVE: &'static str = "WASAPI Exclusive";
    pub const OUTPUT_MODE_WASAPI_SHARED: &'static str = "WASAPI Shared";

    #[cfg(windows)]
    pub fn exclusive_supported() -> bool {
        use crate::audio::wasapi::{FormatNegotiator, WasapiDeviceManager};
        let mgr = WasapiDeviceManager::new();
        mgr.get_active_device()
            .map(|device| FormatNegotiator::exclusive_supported(&device))
            .unwrap_or(false)
    }

    #[cfg(not(windows))]
    pub fn exclusive_supported() -> bool {
        false
    }
}

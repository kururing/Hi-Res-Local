//! Shared interleaved PCM format descriptors used by the WASAPI exclusive path
//! and (later) the decoder → ring → output pipeline.

/// Integer / float sample encoding for interleaved PCM buffers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PcmSampleFormat {
    /// Signed 16-bit little-endian (`WAVE_FORMAT_PCM` / PCM subtype).
    S16,
    /// Signed 24-bit: packed 3 bytes **or** 24-valid-in-32
    /// (`WAVEFORMATEXTENSIBLE` with `wValidBitsPerSample = 24`).
    /// Default [`AudioFormat::bytes_per_sample`] uses the 24-in-32 container
    /// (4 bytes); packed width is tracked on [`crate::audio::wasapi::NegotiatedFormat`].
    S24,
    /// Signed 32-bit little-endian integer PCM.
    S32,
    /// IEEE 754 32-bit float (`KSDATAFORMAT_SUBTYPE_IEEE_FLOAT`).
    F32,
}

/// Complete stream format: rate, channel count, and sample encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: PcmSampleFormat,
    /// Logical bit depth (16 / 24 / 32). For float this is 32.
    pub bit_depth: u32,
}

impl AudioFormat {
    pub fn new(
        sample_rate: u32,
        channels: u16,
        sample_format: PcmSampleFormat,
        bit_depth: u32,
    ) -> Self {
        Self {
            sample_rate,
            channels,
            sample_format,
            bit_depth,
        }
    }

    pub fn s16(sample_rate: u32, channels: u16) -> Self {
        Self::new(sample_rate, channels, PcmSampleFormat::S16, 16)
    }

    pub fn s24_in_32(sample_rate: u32, channels: u16) -> Self {
        Self::new(sample_rate, channels, PcmSampleFormat::S24, 24)
    }

    /// Packed 24-bit (3 bytes/sample). Distinguished from 24-in-32 by
    /// [`Self::uses_packed_s24`] (`bit_depth == 24` and channels block align).
    pub fn s24_packed(sample_rate: u32, channels: u16) -> Self {
        // Encode packed as bit_depth 24 with a sentinel: we use bit_depth 24
        // for both; packed vs 24-in-32 is selected via [`Self::with_container`].
        Self::new(sample_rate, channels, PcmSampleFormat::S24, 24)
    }

    pub fn s32(sample_rate: u32, channels: u16) -> Self {
        Self::new(sample_rate, channels, PcmSampleFormat::S32, 32)
    }

    pub fn f32(sample_rate: u32, channels: u16) -> Self {
        Self::new(sample_rate, channels, PcmSampleFormat::F32, 32)
    }

    /// Bytes for one interleaved frame (all channels at one time step).
    pub fn bytes_per_frame(&self) -> usize {
        self.bytes_per_frame_packed(false)
    }

    /// Frame size on the wire. Packed 24-bit is 3 bytes/sample.
    pub fn bytes_per_frame_packed(&self, packed_s24: bool) -> usize {
        let bps = if packed_s24 && self.sample_format == PcmSampleFormat::S24 {
            3
        } else {
            self.bytes_per_sample()
        };
        bps.saturating_mul(usize::from(self.channels.max(1)))
    }

    /// Storage / container bytes per mono sample.
    ///
    /// Default for [`PcmSampleFormat::S24`] is **24-in-32** (4 bytes). Use
    /// [`Self::bytes_per_sample_packed_s24`] when the negotiated exclusive
    /// format is 3-byte packed PCM.
    pub fn bytes_per_sample(&self) -> usize {
        match self.sample_format {
            PcmSampleFormat::S16 => 2,
            PcmSampleFormat::S24 => 4,
            PcmSampleFormat::S32 | PcmSampleFormat::F32 => 4,
        }
    }

    /// Packed 24-bit container width (3 bytes).
    pub fn bytes_per_sample_packed_s24(&self) -> usize {
        3
    }

    pub fn is_float(&self) -> bool {
        matches!(self.sample_format, PcmSampleFormat::F32)
    }

    pub fn describe(&self) -> String {
        format!(
            "{} Hz / {} ch / {}-bit {:?}",
            self.sample_rate, self.channels, self.bit_depth, self.sample_format
        )
    }
}

/// Largest multiple of `bytes_per_frame` that does not exceed `len`.
#[inline]
pub fn frame_aligned_len(len: usize, bytes_per_frame: usize) -> usize {
    let bpf = bytes_per_frame.max(1);
    (len / bpf) * bpf
}

/// Human-readable rate: `44100` → `"44.1 kHz"`, `48000` → `"48 kHz"`.
pub fn format_sample_rate_khz(sample_rate: u32) -> String {
    if sample_rate == 0 {
        return "0 kHz".into();
    }
    if sample_rate.is_multiple_of(1000) {
        format!("{} kHz", sample_rate / 1000)
    } else {
        let khz = sample_rate as f64 / 1000.0;
        let text = format!("{khz:.3}");
        let text = text.trim_end_matches('0').trim_end_matches('.');
        format!("{text} kHz")
    }
}

#[cfg(test)]
mod tests {
    use super::{format_sample_rate_khz, frame_aligned_len, AudioFormat};

    #[test]
    fn sample_rate_label_uses_one_decimal_for_44k() {
        assert_eq!(format_sample_rate_khz(44_100), "44.1 kHz");
        assert_eq!(format_sample_rate_khz(48_000), "48 kHz");
        assert_eq!(format_sample_rate_khz(88_200), "88.2 kHz");
    }

    #[test]
    fn pcm16_stereo_frame_size() {
        let fmt = AudioFormat::s16(44_100, 2);
        assert_eq!(fmt.bytes_per_sample(), 2);
        assert_eq!(fmt.bytes_per_frame(), 4);
        assert_eq!(frame_aligned_len(6, 4), 4);
        assert_eq!(frame_aligned_len(7, 4), 4);
        assert_eq!(frame_aligned_len(8, 4), 8);
    }

    #[test]
    fn packed_s24_stereo_frame_size() {
        let fmt = AudioFormat::s24_in_32(48_000, 2);
        assert_eq!(fmt.bytes_per_frame(), 8);
        assert_eq!(fmt.bytes_per_frame_packed(true), 6);
    }
}

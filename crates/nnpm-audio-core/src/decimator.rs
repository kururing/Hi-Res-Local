//! FIR DSD -> PCM decimator.
//!
//! Input bytes are channel-byte-interleaved: byte `i` holds eight consecutive
//! 1-bit samples of channel `i % channels` (DSF after planar deinterleave, and
//! raw DFF). Bit 7 is the earliest sample unless `lsb_first` bit-reverses the
//! byte first (DSF `bits_per_sample == 1`).
//!
//! Streaming [`DsdDecimator::push`] holds `TAPS/2` bits of look-ahead so a
//! block boundary does not clamp the right half of the FIR (that click is the
//! light crackle on DSD → PCM). [`DsdDecimator::flush`] emits the tail.
//! Output is scaled by 0.5 (0 dB SACD = −6 dBFS).

use crate::types::{dsd_rate_from_sample_rate, DsdRate};

/// Long enough for a Kaiser β=9 transition to finish before the FIR Nyquist.
/// 64 taps at DSD64 is ~23 µs — DSD noise then aliases into the audible band.
pub const TAPS: usize = 512;
const SACD_GAIN: f64 = 0.5;
const KAISER_BETA: f64 = 9.0;
const MAX_CUTOFF_HZ: f64 = 48_000.0;
const MIN_CUTOFF_HZ: f64 = 20_000.0;

/// Integer decimation from a DSD bit rate to the FIR PCM rate.
///
/// Cap the FIR at 176.4 / 352.8 kHz (the DSD64 / DSD128 rates that stay
/// real-time). DSD256–1024 used to emit 705.6 kHz; 512 taps plus unpacking
/// every bit to `f64` at that rate underruns the ring ("giật").
pub fn dsd_pcm_decimation(rate: DsdRate) -> u32 {
    match rate {
        DsdRate::Dsd64 | DsdRate::Dsd128 => 16,
        DsdRate::Dsd256 => 32,
        DsdRate::Dsd512 => 64,
        DsdRate::Dsd1024 => 128,
    }
}

/// How many packed DSD bytes to pull per decode tick (~80 ms, 64–256 KiB).
pub fn dsd_decode_block_bytes(dsd_sample_rate: u32, channels: u16) -> usize {
    let bytes_per_sec = u64::from(dsd_sample_rate).saturating_mul(u64::from(channels.max(1))) / 8;
    let target = bytes_per_sec.saturating_mul(80) / 1000;
    (target as usize).clamp(64 * 1024, 256 * 1024)
}

/// 44.1-family FIR rate for a [`DsdRate`] (DSD64 → 176.4 kHz).
pub fn dsd_pcm_output_rate(rate: DsdRate) -> u32 {
    rate.sample_rate_hz() / dsd_pcm_decimation(rate)
}

/// FIR PCM rate for a concrete DSD bit clock (44.1 or 48 kHz family).
///
/// Returns 0 if `dsd_sample_rate` is not a known DSD rate.
pub fn dsd_pcm_output_rate_hz(dsd_sample_rate: u32) -> u32 {
    match dsd_rate_from_sample_rate(dsd_sample_rate) {
        Some(rate) => dsd_sample_rate / dsd_pcm_decimation(rate),
        None => 0,
    }
}

pub fn dsd_pcm_output_rate_for_caps(rate: DsdRate, supported: &[u32]) -> u32 {
    let requested = dsd_pcm_output_rate(rate);
    [
        requested, 768_000, 705_600, 384_000, 352_800, 192_000, 176_400, 96_000, 88_200,
    ]
    .into_iter()
    .find(|candidate| *candidate <= requested && supported.contains(candidate))
    .unwrap_or(requested)
}

/// Expand channel-byte-interleaved DSD into interleaved ±1.0 samples at 1-bit rate.
pub fn unpack_dsd_bytes(bytes: &[u8], channels: u16, lsb_first: bool) -> Vec<f64> {
    let ch = usize::from(channels);
    if bytes.is_empty() || ch == 0 {
        return Vec::new();
    }
    let aligned = bytes.len() - (bytes.len() % ch);
    if aligned == 0 {
        return Vec::new();
    }
    let bit_frames = (aligned / ch) * 8;
    let mut bits = vec![0.0; bit_frames * ch];
    for (byte_index, &raw) in bytes[..aligned].iter().enumerate() {
        let value = if lsb_first { raw.reverse_bits() } else { raw };
        let channel = byte_index % ch;
        let time_base = (byte_index / ch) * 8;
        for bit in 0..8 {
            bits[(time_base + bit) * ch + channel] = if value & (0x80 >> bit) != 0 {
                1.0
            } else {
                -1.0
            };
        }
    }
    bits
}

/// Streaming FIR with tap overlap across blocks. One-shot helpers go through this.
pub struct DsdDecimator {
    channels: u16,
    lsb_first: bool,
    dsd_sample_rate: u32,
    target_pcm_rate: u32,
    ratio: usize,
    taps: [f64; TAPS],
    /// Unaligned leftover from the last push (`< channels` bytes).
    pending_bytes: Vec<u8>,
    /// Channel-byte-interleaved DSD, MSB-first (LSB-first input is reversed here).
    packed: Vec<u8>,
    /// Prefix of [`Self::packed`] already used as left-hand FIR context, in bits.
    hist_bit_frames: usize,
}

impl DsdDecimator {
    pub fn new(
        channels: u16,
        lsb_first: bool,
        dsd_sample_rate: u32,
        target_pcm_rate: u32,
    ) -> Option<Self> {
        if channels == 0 || dsd_sample_rate == 0 || target_pcm_rate == 0 {
            return None;
        }
        if dsd_sample_rate % target_pcm_rate != 0 {
            return None;
        }
        let ratio = (dsd_sample_rate / target_pcm_rate) as usize;
        if ratio == 0 {
            return None;
        }
        Some(Self {
            channels,
            lsb_first,
            dsd_sample_rate,
            target_pcm_rate,
            ratio,
            taps: fir_taps(dsd_sample_rate, target_pcm_rate),
            pending_bytes: Vec::new(),
            packed: Vec::new(),
            hist_bit_frames: 0,
        })
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn lsb_first(&self) -> bool {
        self.lsb_first
    }

    pub fn dsd_sample_rate(&self) -> u32 {
        self.dsd_sample_rate
    }

    pub fn target_pcm_rate(&self) -> u32 {
        self.target_pcm_rate
    }

    pub fn reset(&mut self) {
        self.pending_bytes.clear();
        self.packed.clear();
        self.hist_bit_frames = 0;
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<f64> {
        self.convert(bytes, false)
    }

    /// Emit remaining PCM, using zeros past the last DSD bit (end of stream).
    pub fn flush(&mut self) -> Vec<f64> {
        let out = self.convert(&[], true);
        self.reset();
        out
    }

    fn convert(&mut self, bytes: &[u8], flush: bool) -> Vec<f64> {
        self.pending_bytes.extend_from_slice(bytes);
        let ch = usize::from(self.channels);
        let aligned = self.pending_bytes.len() - (self.pending_bytes.len() % ch);
        if aligned > 0 {
            let start = self.packed.len();
            self.packed
                .extend_from_slice(&self.pending_bytes[..aligned]);
            if self.lsb_first {
                for byte in &mut self.packed[start..] {
                    *byte = byte.reverse_bits();
                }
            }
            self.pending_bytes.drain(..aligned);
        }
        if self.packed.is_empty() {
            return Vec::new();
        }

        let total_frames = (self.packed.len() / ch) * 8;
        let new_frames = total_frames.saturating_sub(self.hist_bit_frames);
        let half = TAPS / 2;
        let first_center = self.hist_bit_frames;
        let out_frames = if flush {
            new_frames / self.ratio
        } else if total_frames < half || total_frames - half < first_center {
            return Vec::new();
        } else {
            (total_frames - half - first_center) / self.ratio + 1
        };
        if out_frames == 0 {
            return Vec::new();
        }

        let mut out = vec![0.0; out_frames * ch];
        for frame in 0..out_frames {
            let center = first_center + frame * self.ratio;
            for channel in 0..ch {
                out[frame * ch + channel] =
                    fir_sample_packed(&self.taps, &self.packed, ch, channel, center, total_frames);
            }
        }

        if flush {
            return out;
        }
        let consumed_end = first_center + out_frames * self.ratio;
        let keep_hist = TAPS.min(consumed_end);
        let hist_start = consumed_end - keep_hist;
        let hist_start_bytes = (hist_start / 8) * ch;
        if hist_start_bytes > 0 {
            self.packed.drain(..hist_start_bytes);
        }
        self.hist_bit_frames = keep_hist;
        out
    }
}

pub fn dsd_bytes_to_pcm_f64(
    bytes: &[u8],
    channels: u16,
    lsb_first: bool,
    dsd_sample_rate: u32,
    target_pcm_rate: u32,
) -> Vec<f64> {
    match DsdDecimator::new(channels, lsb_first, dsd_sample_rate, target_pcm_rate) {
        Some(mut decimator) => {
            let mut pcm = decimator.push(bytes);
            pcm.extend(decimator.flush());
            pcm
        }
        None => Vec::new(),
    }
}

fn fir_sample_packed(
    taps: &[f64; TAPS],
    packed: &[u8],
    channels: usize,
    channel: usize,
    center: usize,
    total_frames: usize,
) -> f64 {
    let half = TAPS / 2;
    let start = center as isize - half as isize;
    if start >= 0 && (start as usize) + TAPS <= total_frames && start as usize % 8 == 0 {
        return fir_sample_aligned(taps, packed, channels, channel, start as usize);
    }
    let mut sum = 0.0;
    for (tap, &coef) in taps.iter().enumerate() {
        let index = start + tap as isize;
        if index >= 0 && (index as usize) < total_frames {
            sum += packed_bit(packed, channels, channel, index as usize) * coef;
        }
    }
    sum * SACD_GAIN
}

fn fir_sample_aligned(
    taps: &[f64; TAPS],
    packed: &[u8],
    channels: usize,
    channel: usize,
    start_bit: usize,
) -> f64 {
    let mut sum = 0.0;
    let start_byte = (start_bit / 8) * channels + channel;
    let mut tap = 0;
    for byte_index in 0..(TAPS / 8) {
        let value = packed[start_byte + byte_index * channels];
        for bit in 0..8 {
            let sample = if value & (0x80 >> bit) != 0 {
                1.0
            } else {
                -1.0
            };
            sum += sample * taps[tap];
            tap += 1;
        }
    }
    sum * SACD_GAIN
}

#[inline]
fn packed_bit(packed: &[u8], channels: usize, channel: usize, bit_frame: usize) -> f64 {
    let raw = packed[(bit_frame / 8) * channels + channel];
    if raw & (0x80 >> (bit_frame % 8)) != 0 {
        1.0
    } else {
        -1.0
    }
}

fn cutoff_hz(target_pcm_rate: u32) -> f64 {
    let nyquist = f64::from(target_pcm_rate) * 0.5;
    (nyquist * 0.42).clamp(MIN_CUTOFF_HZ, MAX_CUTOFF_HZ)
}

fn fir_taps(dsd_sample_rate: u32, target_pcm_rate: u32) -> [f64; TAPS] {
    let mut taps = [0.0; TAPS];
    let center = (TAPS / 2) as f64;
    let cutoff = (cutoff_hz(target_pcm_rate) / f64::from(dsd_sample_rate.max(1))).min(0.49);
    let mut sum = 0.0;
    for (i, tap) in taps.iter_mut().enumerate() {
        let x = i as f64 - center;
        let sinc = if x == 0.0 {
            2.0 * cutoff
        } else {
            (2.0 * std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x)
        };
        *tap = sinc * kaiser(i, TAPS, KAISER_BETA);
        sum += *tap;
    }
    if sum.abs() > f64::EPSILON {
        for tap in &mut taps {
            *tap /= sum;
        }
    }
    taps
}

fn kaiser(i: usize, n: usize, beta: f64) -> f64 {
    if n <= 1 {
        return 1.0;
    }
    let r = 2.0 * i as f64 / (n - 1) as f64 - 1.0;
    bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta)
}

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let y = x * x / 4.0;
    for k in 1..40 {
        term *= y / (k * k) as f64;
        sum += term;
        if term < 1e-14 * sum {
            break;
        }
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rates_match_specs() {
        assert_eq!(dsd_pcm_output_rate(DsdRate::Dsd64), 176_400);
        assert_eq!(dsd_pcm_output_rate(DsdRate::Dsd128), 352_800);
        assert_eq!(dsd_pcm_output_rate(DsdRate::Dsd256), 352_800);
        assert_eq!(dsd_pcm_output_rate(DsdRate::Dsd512), 352_800);
        assert_eq!(dsd_pcm_output_rate(DsdRate::Dsd1024), 352_800);
        assert_eq!(dsd_pcm_output_rate_hz(2_822_400), 176_400);
        assert_eq!(dsd_pcm_output_rate_hz(3_072_000), 192_000);
        assert_eq!(dsd_pcm_output_rate_hz(5_644_800), 352_800);
        assert_eq!(dsd_pcm_output_rate_hz(6_144_000), 384_000);
        assert_eq!(dsd_pcm_output_rate_hz(11_289_600), 352_800);
        assert_eq!(dsd_pcm_output_rate_hz(22_579_200), 352_800);
        assert_eq!(dsd_pcm_output_rate_hz(45_158_400), 352_800);
        assert_eq!(dsd_pcm_output_rate_hz(48_000), 0);
        assert_eq!(dsd_decode_block_bytes(2_822_400, 2), 64 * 1024);
        assert!(dsd_decode_block_bytes(45_158_400, 2) >= 256 * 1024);
    }

    #[test]
    fn fir_has_expected_ratio() {
        let out = dsd_bytes_to_pcm_f64(&vec![0xff; 32], 2, false, 2_822_400, 176_400);
        assert_eq!(out.len(), 16);
        assert!(out.iter().all(|v| *v >= 0.0 && *v <= 1.0));
    }

    fn interior_stereo(samples: &[f64]) -> impl Iterator<Item = (f64, f64)> + '_ {
        let frames = samples.len() / 2;
        let skip = (TAPS / 2 / 16).saturating_add(2).min(frames / 4);
        (skip..frames.saturating_sub(skip))
            .map(move |frame| (samples[frame * 2], samples[frame * 2 + 1]))
    }

    #[test]
    fn fir_requires_integer_decimation() {
        assert!(dsd_bytes_to_pcm_f64(&vec![0xff; 64], 2, false, 2_822_400, 48_000).is_empty());
        assert!(!dsd_bytes_to_pcm_f64(&vec![0xff; 64], 2, false, 3_072_000, 192_000).is_empty());
    }

    #[test]
    fn dsd256_decimates_to_dsd128_pcm_rate() {
        let out = dsd_bytes_to_pcm_f64(&vec![0xff; 256], 2, false, 11_289_600, 352_800);
        assert_eq!(out.len(), 64);
        assert!(out.iter().all(|sample| *sample >= 0.0 && *sample <= 1.0));
    }

    #[test]
    fn unpack_keeps_byte_interleaved_stereo_separate() {
        let bits = unpack_dsd_bytes(&[0xFF, 0x00], 2, false);
        assert_eq!(bits.len(), 16);
        for frame in 0..8 {
            assert_eq!(bits[frame * 2], 1.0);
            assert_eq!(bits[frame * 2 + 1], -1.0);
        }
    }

    #[test]
    fn unpack_lsb_first_reverses_the_byte() {
        let msb = unpack_dsd_bytes(&[0x80], 1, false);
        let lsb = unpack_dsd_bytes(&[0x01], 1, true);
        assert_eq!(msb, lsb);
        assert_eq!(msb[0], 1.0);
        assert!(msb[1..].iter().all(|sample| *sample == -1.0));
    }

    #[test]
    fn unpack_drops_trailing_bytes_not_aligned_to_channels() {
        let bits = unpack_dsd_bytes(&[0xFF, 0x00, 0xAA], 2, false);
        assert_eq!(bits.len(), 16);
    }

    #[test]
    fn fir_constant_stereo_does_not_mix_channels() {
        let mut bytes = vec![0u8; 2048];
        for left in bytes.iter_mut().step_by(2) {
            *left = 0xFF;
        }
        let out = dsd_bytes_to_pcm_f64(&bytes, 2, false, 2_822_400, 176_400);
        assert_eq!(out.len(), 1024);
        let mut saw = 0;
        for (left, right) in interior_stereo(&out) {
            assert!(left > 0.4, "left channel mixed or inverted: {left}");
            assert!(right < -0.4, "right channel mixed or inverted: {right}");
            saw += 1;
        }
        assert!(saw > 8, "need interior frames past FIR group delay");
    }

    #[test]
    fn streaming_dsd256_matches_oneshot() {
        let bytes: Vec<u8> = (0..8192u32).map(|i| i.wrapping_mul(13) as u8).collect();
        let once = dsd_bytes_to_pcm_f64(&bytes, 2, false, 11_289_600, 352_800);
        let mut decimator = DsdDecimator::new(2, false, 11_289_600, 352_800).unwrap();
        let mut stream = Vec::new();
        for chunk in bytes.chunks(128) {
            stream.extend(decimator.push(chunk));
        }
        stream.extend(decimator.flush());
        assert_eq!(once.len(), stream.len());
        for (a, b) in once.iter().zip(stream.iter()) {
            assert!((a - b).abs() < 1e-12);
        }
    }

    #[test]
    fn streaming_fir_matches_oneshot_across_blocks() {
        let bytes: Vec<u8> = (0..4096u32).map(|i| i.wrapping_mul(17) as u8).collect();
        let once = dsd_bytes_to_pcm_f64(&bytes, 2, false, 2_822_400, 176_400);
        let mut decimator = DsdDecimator::new(2, false, 2_822_400, 176_400).unwrap();
        let mut stream = Vec::new();
        for chunk in bytes.chunks(96) {
            stream.extend(decimator.push(chunk));
        }
        stream.extend(decimator.flush());
        assert_eq!(once.len(), stream.len());
        for (i, (a, b)) in once.iter().zip(stream.iter()).enumerate() {
            assert!(
                (a - b).abs() < 1e-12,
                "look-ahead mismatch at sample {i}: {a} vs {b}"
            );
        }
        let mut cold = DsdDecimator::new(2, false, 2_822_400, 176_400).unwrap();
        let first = cold.push(&bytes[..512]);
        let second = cold.push(&bytes[512..1024]);
        assert!(
            !first.is_empty() || !second.is_empty(),
            "streaming must emit after look-ahead fills"
        );
        let cold_second = dsd_bytes_to_pcm_f64(&bytes[512..1024], 2, false, 2_822_400, 176_400);
        assert!(
            second
                .iter()
                .zip(cold_second.iter())
                .any(|(a, b)| (a - b).abs() > 1e-6),
            "overlap history must change the second block versus a cold start"
        );
    }

    #[test]
    fn idle_dsd_pattern_is_quiet() {
        let out = dsd_bytes_to_pcm_f64(&vec![0x55; 2048], 2, false, 2_822_400, 176_400);
        let frames = out.len() / 2;
        let skip = TAPS / 2 / 16;
        let mid = &out[skip * 2..(frames - skip) * 2];
        assert!(
            mid.iter().all(|sample| sample.abs() < 0.02),
            "alternating 0x55 must collapse to near-zero after the FIR"
        );
    }

    #[test]
    fn sacd_full_scale_has_six_db_headroom() {
        let out = dsd_bytes_to_pcm_f64(&vec![0xff; 2048], 2, false, 2_822_400, 176_400);
        let mut peak = 0.0f64;
        for (left, _) in interior_stereo(&out) {
            peak = peak.max(left);
        }
        assert!(
            peak > 0.45 && peak < 0.55,
            "0 dB SACD should sit near −6 dBFS, got {peak}"
        );
    }
}

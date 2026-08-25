//! Interleaved f32 ↔ integer/float PCM packing for WASAPI exclusive output.

use crate::audio::pcm::{AudioFormat, PcmSampleFormat};

/// Pack interleaved f32 samples (`[-1, 1]`) into PCM bytes matching `format`.
///
/// When `format.sample_format == S24` and `packed_s24` is true, writes 3-byte
/// little-endian samples; otherwise S24 uses 24-valid-in-32 (4 bytes, low 8 zero).
pub fn f32_to_pcm_bytes(
    samples: &[f32],
    format: &AudioFormat,
    packed_s24: bool,
    out: &mut Vec<u8>,
) {
    out.clear();
    match format.sample_format {
        PcmSampleFormat::S16 => {
            out.reserve(samples.len() * 2);
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        PcmSampleFormat::S24 if packed_s24 => {
            out.reserve(samples.len() * 3);
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
                let bytes = v.to_le_bytes();
                out.extend_from_slice(&bytes[..3]);
            }
        }
        PcmSampleFormat::S24 => {
            // 24-in-32: value in high 24 bits of i32 (WASAPI valid-bits convention
            // stores sample in the most-significant bits of the container).
            out.reserve(samples.len() * 4);
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
                let container = v << 8;
                out.extend_from_slice(&container.to_le_bytes());
            }
        }
        PcmSampleFormat::S32 => {
            out.reserve(samples.len() * 4);
            for &s in samples {
                let v = (s.clamp(-1.0, 1.0) * 2_147_483_647.0).round() as i32;
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
        PcmSampleFormat::F32 => {
            out.reserve(samples.len() * 4);
            for &s in samples {
                out.extend_from_slice(&s.to_le_bytes());
            }
        }
    }
}

/// Unpack interleaved PCM bytes into f32 samples (`[-1, 1]`).
pub fn pcm_bytes_to_f32(bytes: &[u8], format: &AudioFormat, packed_s24: bool, out: &mut Vec<f32>) {
    out.clear();
    match format.sample_format {
        PcmSampleFormat::S16 => {
            let n = bytes.len() / 2;
            out.reserve(n);
            for chunk in bytes.as_chunks::<2>().0 {
                let v = i16::from_le_bytes([chunk[0], chunk[1]]);
                out.push(v as f32 / 32768.0);
            }
        }
        PcmSampleFormat::S24 if packed_s24 => {
            let n = bytes.len() / 3;
            out.reserve(n);
            for chunk in bytes.as_chunks::<3>().0 {
                let mut b = [0u8; 4];
                b[..3].copy_from_slice(chunk);
                // Sign-extend 24-bit
                if b[2] & 0x80 != 0 {
                    b[3] = 0xFF;
                }
                let v = i32::from_le_bytes(b);
                out.push(v as f32 / 8_388_608.0);
            }
        }
        PcmSampleFormat::S24 => {
            let n = bytes.len() / 4;
            out.reserve(n);
            for chunk in bytes.as_chunks::<4>().0 {
                let container = i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                let v = container >> 8;
                out.push(v as f32 / 8_388_608.0);
            }
        }
        PcmSampleFormat::S32 => {
            let n = bytes.len() / 4;
            out.reserve(n);
            for chunk in bytes.as_chunks::<4>().0 {
                let v = i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                out.push(v as f32 / 2_147_483_648.0);
            }
        }
        PcmSampleFormat::F32 => {
            let n = bytes.len() / 4;
            out.reserve(n);
            for chunk in bytes.as_chunks::<4>().0 {
                out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
        }
    }
}

/// Packing-only convert: left-aligned 24-in-32 LE samples → packed 24-bit.
///
/// Used on the bit-perfect path when the decoder emits 24-in-32 (or S32 container)
/// but the exclusive endpoint wants 3-byte packed PCM. No resample / mix / DSP.
pub fn pack_container4_to_packed_s24(src: &[u8], dst: &mut Vec<u8>) {
    dst.clear();
    dst.reserve((src.len() / 4).saturating_mul(3));
    for chunk in src.as_chunks::<4>().0 {
        // WAVEFORMATEXTENSIBLE and FFmpeg S32 store 24 valid bits in the most
        // significant bits, so byte 0 is padding and must be discarded.
        dst.extend_from_slice(&chunk[1..4]);
    }
}

/// Packing-only convert: packed 24-bit → WASAPI 24-in-32 (sample in the high 24 bits).
pub fn pack_packed_s24_to_container4(src: &[u8], dst: &mut Vec<u8>) {
    dst.clear();
    dst.reserve((src.len() / 3).saturating_mul(4));
    for chunk in src.as_chunks::<3>().0 {
        let mut b = [0u8; 4];
        b[1..4].copy_from_slice(chunk);
        dst.extend_from_slice(&b);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::pcm::AudioFormat;

    #[test]
    fn s16_roundtrip_near_identity() {
        let fmt = AudioFormat::s16(48_000, 2);
        let src = vec![0.0, 0.5, -0.5, 1.0];
        let mut bytes = Vec::new();
        f32_to_pcm_bytes(&src, &fmt, false, &mut bytes);
        let mut out = Vec::new();
        pcm_bytes_to_f32(&bytes, &fmt, false, &mut out);
        assert_eq!(out.len(), src.len());
        for (a, b) in src.iter().zip(out.iter()) {
            assert!((a - b).abs() < 0.001, "{a} vs {b}");
        }
    }

    #[test]
    fn packed_s24_byte_width() {
        let fmt = AudioFormat::s24_packed(96_000, 2);
        let src = vec![0.1, -0.2];
        let mut bytes = Vec::new();
        f32_to_pcm_bytes(&src, &fmt, true, &mut bytes);
        assert_eq!(bytes.len(), 6);
    }

    #[test]
    fn container4_to_packed_s24_discards_low_padding_byte() {
        let src = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
        let mut dst = Vec::new();
        pack_container4_to_packed_s24(&src, &mut dst);
        assert_eq!(dst, vec![0x22, 0x33, 0x44, 0x66, 0x77, 0x88]);
    }

    #[test]
    fn packed_s24_container_roundtrip_preserves_samples() {
        let packed = [0x00, 0x00, 0x80, 0x56, 0x34, 0x12, 0xFF, 0xFF, 0x7F];
        let mut container = Vec::new();
        let mut restored = Vec::new();
        pack_packed_s24_to_container4(&packed, &mut container);
        pack_container4_to_packed_s24(&container, &mut restored);
        assert_eq!(restored, packed);
    }
}

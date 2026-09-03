//! WAV helper for corpus tests and bit-perfect compare.

pub fn write_wav_s16(sample_rate: u32, channels: u16, samples: &[i16]) -> Vec<u8> {
    let ch = channels.max(1);
    let data_bytes = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_bytes as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&ch.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * u32::from(ch) * 2;
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&(ch * 2).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

pub fn sine_s16(frames: usize, channels: u16, freq: f64, rate: u32) -> Vec<i16> {
    let ch = usize::from(channels.max(1));
    let mut out = Vec::with_capacity(frames * ch);
    for n in 0..frames {
        let phase = 2.0 * std::f64::consts::PI * freq * (n as f64) / f64::from(rate.max(1));
        let v = (phase.sin() * 0.5 * 32767.0).round() as i16;
        for _ in 0..ch {
            out.push(v);
        }
    }
    out
}

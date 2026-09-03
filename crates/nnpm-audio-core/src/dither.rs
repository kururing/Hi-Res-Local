//! TPDF dither when reducing bit depth.

/// Triangular PDF dither in ±1 LSB peak-to-peak at `target_bits`, applied to f64 samples in ±1.
pub fn tpdf_dither(samples: &mut [f64], target_bits: u16, seed: &mut u64) {
    let bits = target_bits.clamp(8, 24);
    let lsb = 2.0 / ((1u32 << bits) as f64);
    for sample in samples {
        let t = next_triangular(seed);
        *sample = (*sample + t * lsb).clamp(-1.0, 1.0);
    }
}

fn next_unit(seed: &mut u64) -> f64 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
    ((*seed >> 11) as f64) / ((1u64 << 53) as f64)
}

fn next_triangular(seed: &mut u64) -> f64 {
    next_unit(seed) - next_unit(seed)
}

pub fn quantize_f64_to_i32(sample: f64, bits: u16) -> i32 {
    let max = ((1i64 << (bits.saturating_sub(1).min(31))) - 1) as f64;
    (sample.clamp(-1.0, 1.0) * max).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dither_changes_signal_and_stays_in_range() {
        let mut samples = vec![0.5; 64];
        let mut seed = 1u64;
        tpdf_dither(&mut samples, 16, &mut seed);
        assert!(samples.iter().all(|s| *s >= -1.0 && *s <= 1.0));
        assert!(samples.iter().any(|s| (*s - 0.5).abs() > 1e-12));
    }
}

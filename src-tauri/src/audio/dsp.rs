use std::f32::consts::PI;

use crate::audio::dto::{
    CrossfadeConfig, CrossfadeCurve, EqConfig, ReplayGainConfig, ReplayGainInfo, ReplayGainMode,
};

/// Biquad Peaking EQ Filter implementing Audio EQ Cookbook formula
#[derive(Debug, Clone)]
pub struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    // Per-channel state for Direct Form II Transposed (up to 8 channels)
    s1: [f32; 8],
    s2: [f32; 8],
}

impl Default for BiquadFilter {
    fn default() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            s1: [0.0; 8],
            s2: [0.0; 8],
        }
    }
}

impl BiquadFilter {
    pub fn new_peaking(sample_rate: f32, freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let mut filter = Self::default();
        filter.update_peaking(sample_rate, freq_hz, gain_db, q);
        filter
    }

    pub fn update_peaking(&mut self, sample_rate: f32, freq_hz: f32, gain_db: f32, q: f32) {
        if gain_db.abs() < 0.01 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            return;
        }

        let clamped_freq = freq_hz.clamp(20.0, (sample_rate * 0.49).max(20.0));
        let clamped_q = q.max(0.1);
        let a = 10.0f32.powf(gain_db / 40.0);
        let omega = 2.0 * PI * clamped_freq / sample_rate;
        let sin_omega = omega.sin();
        let cos_omega = omega.cos();
        let alpha = sin_omega / (2.0 * clamped_q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_omega;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    #[inline(always)]
    pub fn process_sample(&mut self, input: f32, channel: usize) -> f32 {
        let ch = channel % 8;
        let out = self.b0 * input + self.s1[ch];
        self.s1[ch] = self.b1 * input - self.a1 * out + self.s2[ch];
        self.s2[ch] = self.b2 * input - self.a2 * out;
        out
    }

    pub fn reset_state(&mut self) {
        self.s1 = [0.0; 8];
        self.s2 = [0.0; 8];
    }
}

/// 10-band / Parametric Graphic Equalizer Processor
#[derive(Debug, Clone)]
pub struct EqualizerProcessor {
    sample_rate: u32,
    channels: u16,
    filters: Vec<BiquadFilter>,
    enabled: bool,
    config: EqConfig,
}

impl EqualizerProcessor {
    pub fn new(sample_rate: u32, channels: u16, config: &EqConfig) -> Self {
        let mut processor = Self {
            sample_rate,
            channels,
            filters: Vec::new(),
            enabled: config.enabled,
            config: config.clone(),
        };
        processor.update_config(config);
        processor
    }

    pub fn set_output_spec(&mut self, sample_rate: u32, channels: u16) {
        if self.sample_rate == sample_rate && self.channels == channels {
            return;
        }
        self.sample_rate = sample_rate;
        self.channels = channels.max(1);
        let config = self.config.clone();
        self.update_config(&config);
        self.reset();
    }

    pub fn update_config(&mut self, config: &EqConfig) {
        self.config = config.clone();
        self.enabled = config.enabled;
        let sr = self.sample_rate as f32;

        if self.filters.len() != config.bands.len() {
            self.filters = vec![BiquadFilter::default(); config.bands.len()];
        }

        for (filter, band) in self.filters.iter_mut().zip(config.bands.iter()) {
            filter.update_peaking(sr, band.freq_hz, band.gain_db, band.q);
        }
    }

    pub fn process_interleaved(&mut self, buffer: &mut [f32]) {
        if !self.enabled || self.filters.is_empty() {
            return;
        }

        let num_channels = self.channels as usize;
        if num_channels == 0 {
            return;
        }

        for (idx, sample) in buffer.iter_mut().enumerate() {
            let channel = idx % num_channels;
            let mut val = *sample;
            for filter in &mut self.filters {
                val = filter.process_sample(val, channel);
            }
            *sample = val;
        }
    }

    pub fn reset(&mut self) {
        for filter in &mut self.filters {
            filter.reset_state();
        }
    }
}

/// ReplayGain DSP Processor
#[derive(Debug, Clone)]
pub struct ReplayGainProcessor {
    linear_gain: f32,
    current_gain: f32,
    smoothing_factor: f32,
}

impl Default for ReplayGainProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl ReplayGainProcessor {
    pub fn new() -> Self {
        Self {
            linear_gain: 1.0,
            current_gain: 1.0,
            smoothing_factor: 0.005,
        }
    }

    pub fn calculate_linear_gain(config: &ReplayGainConfig, info: Option<&ReplayGainInfo>) -> f32 {
        if config.mode == ReplayGainMode::Off {
            return 10.0f32.powf(config.preamp_db / 20.0);
        }

        let (gain_db_opt, peak_opt) = match info {
            Some(i) => match config.mode {
                ReplayGainMode::Track => (i.track_gain_db, i.track_peak),
                ReplayGainMode::Album => (
                    i.album_gain_db.or(i.track_gain_db),
                    i.album_peak.or(i.track_peak),
                ),
                ReplayGainMode::Off => (None, None),
            },
            None => (None, None),
        };

        let effective_gain_db = gain_db_opt.unwrap_or(config.fallback_gain_db) + config.preamp_db;
        let mut linear = 10.0f32.powf(effective_gain_db / 20.0);

        if config.prevent_clipping {
            if let Some(peak) = peak_opt {
                if peak > 0.0 && (linear * peak) > 1.0 {
                    linear = 1.0 / peak;
                }
            }
        }

        linear
    }

    pub fn update(&mut self, config: &ReplayGainConfig, info: Option<&ReplayGainInfo>) {
        self.linear_gain = Self::calculate_linear_gain(config, info);
    }

    #[inline(always)]
    pub fn process_interleaved(&mut self, buffer: &mut [f32]) {
        for sample in buffer.iter_mut() {
            // Smooth gain transition
            self.current_gain += (self.linear_gain - self.current_gain) * self.smoothing_factor;
            *sample *= self.current_gain;
        }
    }
}

/// Crossfade Calculator and Processor
#[derive(Debug, Clone)]
pub struct CrossfadeProcessor {
    config: CrossfadeConfig,
    sample_rate: u32,
    channels: u16,
}

impl CrossfadeProcessor {
    pub fn new(sample_rate: u32, channels: u16, config: CrossfadeConfig) -> Self {
        Self {
            config,
            sample_rate,
            channels,
        }
    }

    pub fn config(&self) -> &CrossfadeConfig {
        &self.config
    }

    pub fn set_config(&mut self, config: CrossfadeConfig) {
        self.config = config;
    }

    pub fn duration_samples(&self) -> usize {
        if !self.config.enabled || self.config.duration_ms == 0 {
            return 0;
        }
        let frames = (self.sample_rate as u64 * self.config.duration_ms) / 1000;
        (frames * self.channels as u64) as usize
    }

    /// Calculate gain factors for outgoing (out) and incoming (in) tracks at progress t (0.0 to 1.0)
    #[inline(always)]
    pub fn calculate_gains(progress: f32, curve: CrossfadeCurve) -> (f32, f32) {
        let t = progress.clamp(0.0, 1.0);
        match curve {
            CrossfadeCurve::Linear => (1.0 - t, t),
            CrossfadeCurve::EqualPower => {
                let angle = t * (PI * 0.5);
                (angle.cos(), angle.sin())
            }
        }
    }

    /// Mix two sample slices with crossfade curve
    pub fn mix_crossfade(
        outgoing: &[f32],
        incoming: &[f32],
        output: &mut [f32],
        curve: CrossfadeCurve,
    ) {
        let len = outgoing.len().min(incoming.len()).min(output.len());
        if len == 0 {
            return;
        }

        for i in 0..len {
            let progress = i as f32 / len as f32;
            let (gain_out, gain_in) = Self::calculate_gains(progress, curve);
            output[i] = (outgoing[i] * gain_out) + (incoming[i] * gain_in);
        }
    }
}

/// Soft Limiter to avoid digital clipping with smooth tanh curve
pub fn soft_limit(buffer: &mut [f32]) {
    for sample in buffer.iter_mut() {
        let s = *sample;
        if s > 1.0 {
            *sample = 1.0 + (s - 1.0).tanh() * 0.2;
        } else if s < -1.0 {
            *sample = -1.0 + (s + 1.0).tanh() * 0.2;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::dto::EqPreset;

    #[test]
    fn test_biquad_unity_gain_at_zero_db() {
        let mut filter = BiquadFilter::new_peaking(44100.0, 1000.0, 0.0, 1.414);
        let input = 0.5f32;
        let out = filter.process_sample(input, 0);
        assert!((out - input).abs() < 1e-5);
    }

    #[test]
    fn test_biquad_boost_and_cut() {
        let mut boost = BiquadFilter::new_peaking(44100.0, 1000.0, 6.0, 1.414);
        let mut cut = BiquadFilter::new_peaking(44100.0, 1000.0, -6.0, 1.414);

        // Process a test tone at 1000Hz
        let sr = 44100.0;
        let freq = 1000.0;
        let mut max_boost = 0.0f32;
        let mut max_cut = 0.0f32;

        for i in 0..441 {
            let t = i as f32 / sr;
            let sample = (2.0 * PI * freq * t).sin();
            let b = boost.process_sample(sample, 0);
            let c = cut.process_sample(sample, 0);
            if i > 200 {
                max_boost = max_boost.max(b.abs());
                max_cut = max_cut.max(c.abs());
            }
        }

        assert!(max_boost > 1.2, "Boost should amplify resonant frequency");
        assert!(max_cut < 0.8, "Cut should attenuate resonant frequency");
    }

    #[test]
    fn test_equalizer_processor() {
        let mut config = EqConfig::default();
        config.enabled = true;
        config.apply_preset(EqPreset::BassBoost);

        let mut eq = EqualizerProcessor::new(44100, 2, &config);
        let mut buffer = vec![0.5f32; 100];
        eq.process_interleaved(&mut buffer);

        // Buffer processed without NaN or infinities
        for sample in buffer {
            assert!(sample.is_finite());
        }
    }

    #[test]
    fn equalizer_rebuilds_for_changed_device_spec() {
        let mut config = EqConfig {
            enabled: true,
            ..EqConfig::default()
        };
        config.apply_preset(EqPreset::Vocal);
        let mut eq = EqualizerProcessor::new(44_100, 2, &config);
        eq.set_output_spec(96_000, 6);
        assert_eq!(eq.sample_rate, 96_000);
        assert_eq!(eq.channels, 6);
        let mut buffer = vec![0.25; 6 * 128];
        eq.process_interleaved(&mut buffer);
        assert!(buffer.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn test_replay_gain_clipping_prevention() {
        let config = ReplayGainConfig {
            mode: ReplayGainMode::Track,
            preamp_db: 6.0,
            prevent_clipping: true,
            fallback_gain_db: 0.0,
        };

        let info_high_peak = ReplayGainInfo {
            track_gain_db: Some(4.0),
            track_peak: Some(0.95),
            album_gain_db: None,
            album_peak: None,
        };

        let linear = ReplayGainProcessor::calculate_linear_gain(&config, Some(&info_high_peak));
        // Total desired gain would be +10dB (~3.16), but peak is 0.95, so max safe gain is 1.0 / 0.95 ~ 1.0526
        assert!(linear <= (1.0 / 0.95 + 1e-4));
        assert!(linear > 1.0);
    }

    #[test]
    fn test_crossfade_equal_power_energy_preservation() {
        for step in 0..=10 {
            let progress = step as f32 / 10.0;
            let (out_g, in_g) =
                CrossfadeProcessor::calculate_gains(progress, CrossfadeCurve::EqualPower);
            let energy = (out_g * out_g) + (in_g * in_g);
            assert!(
                (energy - 1.0).abs() < 1e-5,
                "Equal power crossfade must preserve energy sum = 1.0 at step {}",
                step
            );
        }
    }

    #[test]
    fn test_soft_limiter() {
        let mut buffer = vec![0.5, 1.5, -2.0, 0.0];
        soft_limit(&mut buffer);
        assert_eq!(buffer[0], 0.5);
        assert!(buffer[1] < 1.3 && buffer[1] > 1.0);
        assert!(buffer[2] > -1.3 && buffer[2] < -1.0);
    }
}

//! DSP graph: DSD FIR → optional MQA 2× → Rubato → EQ → ReplayGain → limiter + TPDF.

use rubato::{FftFixedIn, Resampler};

use crate::decimator::{dsd_pcm_output_rate_hz, DsdDecimator};
use crate::dither::{quantize_f64_to_i32, tpdf_dither};
use crate::dsd::DsdBlock;
use crate::error::CoreResult;
use crate::mqa::unfolded_target_rate;

#[derive(Debug, Clone)]
pub struct GraphConfig {
    pub bit_perfect: bool,
    pub eq_enabled: bool,
    pub eq_gains_db: Vec<f32>,
    pub replaygain_db: f32,
    pub target_sample_rate: Option<u32>,
    pub target_bit_depth: u16,
    /// Apply the graph's soft limiter. Disabled for transparent decode/SRC.
    pub limiter_enabled: bool,
    /// Add TPDF immediately before an explicit integer quantization stage.
    /// Float output must leave this disabled.
    pub dither_enabled: bool,
    pub mqa_software_upsample: bool,
    pub encoded_mqa_rate: Option<u32>,
}

impl Default for GraphConfig {
    fn default() -> Self {
        Self {
            bit_perfect: false,
            eq_enabled: false,
            eq_gains_db: vec![0.0; 10],
            replaygain_db: 0.0,
            target_sample_rate: None,
            target_bit_depth: 24,
            limiter_enabled: false,
            dither_enabled: false,
            mqa_software_upsample: false,
            encoded_mqa_rate: None,
        }
    }
}

pub struct ProcessingGraph {
    config: GraphConfig,
    channels: u16,
    input_rate: u32,
    resampler: Option<FftFixedIn<f64>>,
    resample_pending: Vec<f64>,
    resample_input_frames: u64,
    resample_output_frames: u64,
    resample_delay_frames: usize,
    dither_seed: u64,
    eq: Vec<BiquadF64>,
    dsd_fir: Option<DsdDecimator>,
}

impl ProcessingGraph {
    pub fn new(input_rate: u32, channels: u16, config: GraphConfig) -> CoreResult<Self> {
        let mut graph = Self {
            config,
            channels,
            input_rate,
            resampler: None,
            resample_pending: Vec::new(),
            resample_input_frames: 0,
            resample_output_frames: 0,
            resample_delay_frames: 0,
            dither_seed: 0xC0FFEE,
            eq: Vec::new(),
            dsd_fir: None,
        };
        graph.rebuild()?;
        Ok(graph)
    }

    pub fn config(&self) -> &GraphConfig {
        &self.config
    }

    pub fn bypass(&self) -> bool {
        self.config.bit_perfect
    }

    fn rebuild(&mut self) -> CoreResult<()> {
        self.resampler = None;
        self.resample_pending.clear();
        self.resample_input_frames = 0;
        self.resample_output_frames = 0;
        self.resample_delay_frames = 0;
        if !self.config.bit_perfect {
            if let Some(target) = self.effective_target_rate() {
                if target != self.input_rate && target > 0 && self.input_rate > 0 {
                    let resampler = FftFixedIn::<f64>::new(
                        self.input_rate as usize,
                        target as usize,
                        1024,
                        2,
                        usize::from(self.channels.max(1)),
                    )
                    .map_err(|e| crate::error::CoreError::Decode(format!("rubato: {e}")))?;
                    self.resample_delay_frames = resampler.output_delay();
                    self.resampler = Some(resampler);
                }
            }
        }
        self.eq.clear();
        if self.config.eq_enabled {
            let freqs = [
                32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
            ];
            for (i, freq) in freqs.iter().enumerate() {
                let gain = self.config.eq_gains_db.get(i).copied().unwrap_or(0.0);
                self.eq.push(BiquadF64::peaking(
                    self.input_rate as f64,
                    *freq,
                    f64::from(gain),
                    1.0,
                ));
            }
        }
        Ok(())
    }

    fn effective_target_rate(&self) -> Option<u32> {
        if self.config.mqa_software_upsample {
            if let Some(encoded) = self.config.encoded_mqa_rate {
                return Some(unfolded_target_rate(encoded));
            }
        }
        self.config.target_sample_rate
    }

    pub fn process_f32(&mut self, input: &[f32]) -> Vec<f32> {
        if self.config.bit_perfect {
            return input.to_vec();
        }
        let mut work: Vec<f64> = input.iter().map(|s| f64::from(*s)).collect();
        self.apply_eq(&mut work);
        if self.config.replaygain_db.abs() > 0.01 {
            let g = 10f64.powf(f64::from(self.config.replaygain_db) / 20.0);
            for s in &mut work {
                *s *= g;
            }
        }
        work = self.resample(work, false);
        self.finish_f64(work)
    }

    /// Flush FIR look-ahead, then Rubato's filter delay, at end-of-stream.
    pub fn flush(&mut self) -> Vec<f32> {
        let mut tail = Vec::new();
        if let Some(fir) = self.dsd_fir.as_mut() {
            tail = fir.flush().into_iter().map(|s| s as f32).collect();
        }
        let mut out = if tail.is_empty() {
            Vec::new()
        } else {
            self.process_f32(&tail)
        };
        let flushed = self.resample(Vec::new(), true);
        out.extend(self.finish_f64(flushed));
        out
    }

    fn finish_f64(&mut self, mut work: Vec<f64>) -> Vec<f32> {
        if work.is_empty() {
            return Vec::new();
        }
        if self.config.limiter_enabled {
            limiter(&mut work);
        }
        if self.config.dither_enabled {
            tpdf_dither(
                &mut work,
                self.config.target_bit_depth,
                &mut self.dither_seed,
            );
        }
        work.into_iter().map(|s| s as f32).collect()
    }

    /// Reset FIR overlap and Rubato delay (seek / new stream).
    pub fn reset_stream(&mut self) -> CoreResult<()> {
        if let Some(fir) = self.dsd_fir.as_mut() {
            fir.reset();
        }
        self.rebuild()
    }

    /// FIR at an integer DSD÷N rate, then resample to [`GraphConfig::target_sample_rate`].
    ///
    /// Never rebuilds the graph per block — that would wipe Rubato/EQ state and
    /// is what produced silence when the device rate (often 48 kHz) is not an
    /// integer divisor of the DSD bit clock.
    pub fn process_dsd_block(&mut self, block: &DsdBlock, dsd_sample_rate: u32) -> Vec<f32> {
        let fir_rate = dsd_pcm_output_rate_hz(dsd_sample_rate);
        if fir_rate == 0 || block.channels == 0 {
            return Vec::new();
        }
        let need_new_fir = match &self.dsd_fir {
            None => true,
            Some(fir) => {
                fir.channels() != block.channels
                    || fir.lsb_first() != block.lsb_first
                    || fir.dsd_sample_rate() != dsd_sample_rate
                    || fir.target_pcm_rate() != fir_rate
            }
        };
        if need_new_fir {
            self.dsd_fir =
                DsdDecimator::new(block.channels, block.lsb_first, dsd_sample_rate, fir_rate);
        }
        if self.input_rate != fir_rate || self.channels != block.channels {
            self.input_rate = fir_rate;
            self.channels = block.channels;
            let _ = self.rebuild();
        }
        let Some(fir) = self.dsd_fir.as_mut() else {
            return Vec::new();
        };
        let pcm = fir.push(&block.bytes);
        if pcm.is_empty() {
            return Vec::new();
        }
        let f32s: Vec<f32> = pcm.into_iter().map(|s| s as f32).collect();
        self.process_f32(&f32s)
    }

    fn resample(&mut self, input: Vec<f64>, flush: bool) -> Vec<f64> {
        let target = self.effective_target_rate().unwrap_or(self.input_rate);
        let Some(resampler) = self.resampler.as_mut() else {
            return input;
        };
        let ch = usize::from(self.channels.max(1));
        let complete = input.len() - (input.len() % ch);
        if complete > 0 {
            self.resample_input_frames += (complete / ch) as u64;
            self.resample_pending.extend_from_slice(&input[..complete]);
        }
        let mut result = Vec::new();

        loop {
            let needed = resampler.input_frames_next();
            let available = self.resample_pending.len() / ch;
            if available < needed {
                break;
            }
            let planar: Vec<Vec<f64>> = (0..ch)
                .map(|c| {
                    (0..needed)
                        .map(|f| self.resample_pending[f * ch + c])
                        .collect()
                })
                .collect();
            let out = match resampler.process(&planar, None) {
                Ok(out) => out,
                Err(_) => break,
            };
            self.resample_pending.drain(..needed * ch);
            append_interleaved(
                &out,
                ch,
                &mut self.resample_delay_frames,
                &mut self.resample_output_frames,
                &mut result,
                None,
            );
        }

        if !flush {
            return result;
        }

        let expected = self
            .resample_input_frames
            .saturating_mul(u64::from(target))
            .saturating_add(u64::from(self.input_rate) / 2)
            / u64::from(self.input_rate.max(1));

        if !self.resample_pending.is_empty() {
            let frames = self.resample_pending.len() / ch;
            let needed = resampler.input_frames_next();
            // FftFixedIn cannot flush a fragment shorter than one FFT block on
            // every backend. Extend the final frame internally, then cap emitted
            // frames to the exact duration calculated from real input only.
            let planar: Vec<Vec<f64>> = (0..ch)
                .map(|c| {
                    let mut channel: Vec<f64> = (0..frames)
                        .map(|f| self.resample_pending[f * ch + c])
                        .collect();
                    let tail = channel.last().copied().unwrap_or(0.0);
                    channel.resize(needed, tail);
                    channel
                })
                .collect();
            if let Ok(out) = resampler.process(&planar, None) {
                self.resample_pending.clear();
                append_interleaved(
                    &out,
                    ch,
                    &mut self.resample_delay_frames,
                    &mut self.resample_output_frames,
                    &mut result,
                    Some(expected),
                );
            }
        }
        // `process_partial(None)` may produce no frames for FftFixedIn when the
        // entire stream is shorter than one FFT block. Feed silent full blocks
        // to advance its internal delay, while the exact real-input duration
        // cap prevents any padding from escaping to the caller.
        for _ in 0..8 {
            if self.resample_output_frames >= expected {
                break;
            }
            let needed = resampler.input_frames_next();
            let silence = vec![vec![0.0; needed]; ch];
            let Ok(out) = resampler.process(&silence, None) else {
                break;
            };
            append_interleaved(
                &out,
                ch,
                &mut self.resample_delay_frames,
                &mut self.resample_output_frames,
                &mut result,
                Some(expected),
            );
        }
        result
    }

    fn apply_eq(&mut self, samples: &mut [f64]) {
        if self.eq.is_empty() {
            return;
        }
        let ch = usize::from(self.channels.max(1));
        for (i, sample) in samples.iter_mut().enumerate() {
            let channel = i % ch;
            let mut v = *sample;
            for filter in &mut self.eq {
                v = filter.process(v, channel);
            }
            *sample = v;
        }
    }

    pub fn pack_pcm_i32(&self, samples: &[f32]) -> Vec<i32> {
        samples
            .iter()
            .map(|s| quantize_f64_to_i32(f64::from(*s), self.config.target_bit_depth))
            .collect()
    }
}

fn append_interleaved(
    planar: &[Vec<f64>],
    channels: usize,
    delay_remaining: &mut usize,
    emitted_frames: &mut u64,
    output: &mut Vec<f64>,
    frame_limit: Option<u64>,
) {
    let frames = planar.first().map(Vec::len).unwrap_or(0);
    for frame in 0..frames {
        if *delay_remaining > 0 {
            *delay_remaining -= 1;
            continue;
        }
        if frame_limit.is_some_and(|limit| *emitted_frames >= limit) {
            break;
        }
        for channel in 0..channels {
            output.push(planar[channel][frame]);
        }
        *emitted_frames += 1;
    }
}

fn limiter(samples: &mut [f64]) {
    for s in samples {
        let x = *s;
        *s = if x.abs() > 0.98 {
            x.signum() * (0.98 + 0.02 * (1.0 - (-((x.abs() - 0.98) * 8.0)).exp()))
        } else {
            x
        }
        .clamp(-1.0, 1.0);
    }
}

struct BiquadF64 {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    s1: [f64; 8],
    s2: [f64; 8],
}

impl BiquadF64 {
    fn peaking(sample_rate: f64, freq: f64, gain_db: f64, q: f64) -> Self {
        if gain_db.abs() < 0.01 {
            return Self {
                b0: 1.0,
                b1: 0.0,
                b2: 0.0,
                a1: 0.0,
                a2: 0.0,
                s1: [0.0; 8],
                s2: [0.0; 8],
            };
        }
        let a = 10f64.powf(gain_db / 40.0);
        let omega = 2.0 * std::f64::consts::PI * freq / sample_rate;
        let alpha = omega.sin() / (2.0 * q.max(0.1));
        let cos = omega.cos();
        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos;
        let a2 = 1.0 - alpha / a;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            s1: [0.0; 8],
            s2: [0.0; 8],
        }
    }

    fn process(&mut self, input: f64, channel: usize) -> f64 {
        let ch = channel % 8;
        let out = self.b0 * input + self.s1[ch];
        self.s1[ch] = self.b1 * input - self.a1 * out + self.s2[ch];
        self.s2[ch] = self.b2 * input - self.a2 * out;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_resampler_keeps_remainder_and_flushes_exact_length() {
        let mut graph = ProcessingGraph::new(
            44_100,
            2,
            GraphConfig {
                target_sample_rate: Some(48_000),
                target_bit_depth: 32,
                ..GraphConfig::default()
            },
        )
        .unwrap();
        let frames = 5_003usize;
        let input: Vec<f32> = (0..frames)
            .flat_map(|frame| {
                let sample = ((frame as f32) * 0.01).sin() * 0.5;
                [sample, -sample]
            })
            .collect();

        let mut output = Vec::new();
        let mut offset = 0;
        for chunk_frames in [17usize, 701, 2_300, 13, 1_972] {
            let end = (offset + chunk_frames * 2).min(input.len());
            output.extend(graph.process_f32(&input[offset..end]));
            offset = end;
        }
        assert_eq!(offset, input.len());
        output.extend(graph.flush());

        let expected_frames = ((frames as u64 * 48_000 + 22_050) / 44_100) as usize;
        assert_eq!(output.len(), expected_frames * 2);
        assert!(output.iter().any(|sample| sample.abs() > 0.01));
    }

    #[test]
    fn resampler_flushes_a_stream_shorter_than_one_fft_block() {
        let mut graph = ProcessingGraph::new(
            44_100,
            1,
            GraphConfig {
                target_sample_rate: Some(88_200),
                ..GraphConfig::default()
            },
        )
        .unwrap();
        let mut output = graph.process_f32(&[0.25, -0.5, 0.75]);
        output.extend(graph.flush());

        assert_eq!(output.len(), 6);
        assert!(output.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn dsd64_fir_then_rubato_to_48k_is_not_empty() {
        use crate::dsd::DstStatus;
        use crate::types::DsdRate;

        let mut graph = ProcessingGraph::new(
            176_400,
            2,
            GraphConfig {
                target_sample_rate: Some(48_000),
                target_bit_depth: 32,
                ..GraphConfig::default()
            },
        )
        .unwrap();
        // 4096 stereo bytes → 1024 FIR frames at 176.4 kHz (one Rubato chunk).
        let block = DsdBlock {
            bytes: vec![0xFF; 4096],
            channels: 2,
            dsd_rate: DsdRate::Dsd64,
            lsb_first: false,
            timestamp_ms: 0,
            dst: DstStatus::None,
        };
        let mut output = graph.process_dsd_block(&block, 2_822_400);
        output.extend(graph.flush());
        assert!(
            !output.is_empty(),
            "FIR+Rubato must emit PCM when the device rate is 48 kHz"
        );
        assert!(output.iter().any(|sample| sample.abs() > 0.01));
    }

    #[test]
    fn float_graph_is_transparent_when_limiter_and_dither_are_disabled() {
        let mut graph = ProcessingGraph::new(48_000, 2, GraphConfig::default()).unwrap();
        let input = vec![0.999_9, -0.999_9, 0.125, -0.125];
        assert_eq!(graph.process_f32(&input), input);
    }
}

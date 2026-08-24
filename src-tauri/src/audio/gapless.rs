use crate::audio::decoder::AudioDecoder;
use crate::audio::dsp::CrossfadeProcessor;
use crate::audio::dto::{AudioTrack, CrossfadeConfig, CrossfadeCurve, QualityBadge, ReplayGainInfo};
use crate::audio::error::{AudioError, AudioResult};

/// High-quality linear / fractional resampler for multi-channel audio
#[derive(Debug, Clone)]
pub struct LinearResampler {
    from_rate: u32,
    to_rate: u32,
    channels: u16,
    phase: f64,
}

impl LinearResampler {
    pub fn new(from_rate: u32, to_rate: u32, channels: u16) -> Self {
        Self {
            from_rate,
            to_rate,
            channels,
            phase: 0.0,
        }
    }

    pub fn is_identity(&self) -> bool {
        self.from_rate == self.to_rate
    }

    pub fn resample(&mut self, input: &[f32], output: &mut Vec<f32>) {
        if self.is_identity() || self.from_rate == 0 || self.to_rate == 0 {
            output.extend_from_slice(input);
            return;
        }

        let ch = self.channels as usize;
        let num_input_frames = input.len() / ch;
        if num_input_frames < 2 {
            return;
        }

        let expected = ((num_input_frames as f64 * self.to_rate as f64)
            / self.from_rate.max(1) as f64) as usize
            * ch;
        output.reserve(expected);

        let ratio = self.from_rate as f64 / self.to_rate as f64;

        while (self.phase as usize + 1) < num_input_frames {
            let idx0 = self.phase as usize;
            let idx1 = idx0 + 1;
            let frac = (self.phase - idx0 as f64) as f32;

            for c in 0..ch {
                let s0 = input[idx0 * ch + c];
                let s1 = input[idx1 * ch + c];
                let interpolated = s0 + (s1 - s0) * frac;
                output.push(interpolated);
            }

            self.phase += ratio;
        }

        self.phase -= num_input_frames.saturating_sub(1) as f64;
        if self.phase < 0.0 {
            self.phase = 0.0;
        }
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
    }
}

/// A decoded or preloaded track source ready for gapless playback
pub struct PreloadedTrack {
    pub track: AudioTrack,
    pub decoder: AudioDecoder,
    pub predecoded_samples: Vec<f32>,
    pub is_eof: bool,
}

impl PreloadedTrack {
    pub fn open(track: AudioTrack) -> AudioResult<Self> {
        let mut decoder = AudioDecoder::open(&track.path)?;
        let mut predecoded_samples = Vec::new();

        // Preload the first few packets (~100ms) for instantaneous start
        for _ in 0..4 {
            if let Some(packet) = decoder.decode_next_packet()? {
                predecoded_samples.extend_from_slice(packet);
            } else {
                break;
            }
        }

        Ok(Self {
            track,
            decoder,
            predecoded_samples,
            is_eof: false,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.decoder.sample_rate()
    }

    pub fn channels(&self) -> u16 {
        self.decoder.channels()
    }

    pub fn quality_badge(&self) -> &QualityBadge {
        self.decoder.quality_badge()
    }

    pub fn replay_gain_info(&self) -> Option<&ReplayGainInfo> {
        self.decoder.replay_gain_info()
    }
}

/// The previous track while a crossfade into the new current track is in progress.
struct FadingOutSource {
    source: PreloadedTrack,
    resampler: Option<LinearResampler>,
    buffer: Vec<f32>,
    offset: usize,
    /// Interleaved samples already faded (at output spec).
    fade_pos: u64,
    /// Total interleaved samples the fade spans (at output spec).
    fade_total: u64,
    curve: CrossfadeCurve,
}

/// Manages active playback source and preloading the next track for seamless gapless playback
pub struct GaplessController {
    current_source: Option<PreloadedTrack>,
    next_preloaded: Option<PreloadedTrack>,
    predecode_buffer: Vec<f32>,
    predecode_offset: usize,
    resampler: Option<LinearResampler>,
    output_sample_rate: u32,
    output_channels: u16,
    samples_played: u64,
    crossfade: CrossfadeConfig,
    fading_out: Option<FadingOutSource>,
    fade_scratch: Vec<f32>,
}

impl GaplessController {
    pub fn new(output_sample_rate: u32, output_channels: u16) -> Self {
        Self {
            current_source: None,
            next_preloaded: None,
            predecode_buffer: Vec::with_capacity(8192),
            predecode_offset: 0,
            resampler: None,
            output_sample_rate,
            output_channels,
            samples_played: 0,
            crossfade: CrossfadeConfig::default(),
            fading_out: None,
            fade_scratch: Vec::new(),
        }
    }

    pub fn set_crossfade(&mut self, config: CrossfadeConfig) {
        self.crossfade = config;
    }

    pub fn set_output_spec(&mut self, sample_rate: u32, channels: u16) {
        self.output_sample_rate = sample_rate;
        self.output_channels = channels;
        self.update_resampler();
    }

    fn update_resampler(&mut self) {
        if let Some(ref current) = self.current_source {
            if current.sample_rate() != self.output_sample_rate {
                self.resampler = Some(LinearResampler::new(
                    current.sample_rate(),
                    self.output_sample_rate,
                    self.output_channels,
                ));
                return;
            }
        }
        self.resampler = None;
    }

    pub fn load_track(&mut self, track: AudioTrack) -> AudioResult<()> {
        let preloaded = PreloadedTrack::open(track)?;
        self.set_current(preloaded);
        Ok(())
    }

    pub fn set_current(&mut self, preloaded: PreloadedTrack) {
        self.current_source = Some(preloaded);
        // A manually opened track starts a new playback generation. Never let a
        // preload left by the previous queue transition after it reaches EOF.
        self.next_preloaded = None;
        self.fading_out = None;
        self.predecode_buffer.clear();
        self.predecode_offset = 0;
        self.samples_played = 0;
        self.update_resampler();
    }

    pub fn preload_next(&mut self, track: AudioTrack) -> AudioResult<()> {
        let preloaded = PreloadedTrack::open(track)?;
        self.set_preloaded_next(preloaded);
        Ok(())
    }

    pub fn set_preloaded_next(&mut self, preloaded: PreloadedTrack) {
        self.next_preloaded = Some(preloaded);
    }

    pub fn clear_preload(&mut self) {
        self.next_preloaded = None;
    }

    pub fn has_current(&self) -> bool {
        self.current_source.is_some()
    }

    pub fn clear_current(&mut self) {
        self.current_source = None;
        self.next_preloaded = None;
        self.fading_out = None;
        self.predecode_buffer.clear();
        self.predecode_offset = 0;
        self.samples_played = 0;
        self.resampler = None;
    }

    pub fn current_track(&self) -> Option<&AudioTrack> {
        self.current_source.as_ref().map(|s| &s.track)
    }

    pub fn current_quality_badge(&self) -> Option<QualityBadge> {
        self.current_source
            .as_ref()
            .map(|s| s.quality_badge().clone())
    }

    pub fn current_replay_gain(&self) -> Option<ReplayGainInfo> {
        self.current_source
            .as_ref()
            .and_then(|s| s.replay_gain_info().cloned())
    }

    pub fn current_position_ms(&self) -> u64 {
        if self.output_sample_rate == 0 || self.output_channels == 0 {
            return 0;
        }
        let total_frames = self.samples_played / (self.output_channels as u64);
        (total_frames * 1000) / (self.output_sample_rate as u64)
    }

    pub fn current_duration_ms(&self) -> u64 {
        self.current_source
            .as_ref()
            .map(|source| source.decoder.duration_ms())
            .unwrap_or(0)
    }

    pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        self.fading_out = None;
        if let Some(ref mut source) = self.current_source {
            let actual = source.decoder.seek(target_ms)?;
            source.predecoded_samples.clear();
            self.predecode_buffer.clear();
            self.predecode_offset = 0;
            source.is_eof = false;
            let frames = (actual * self.output_sample_rate as u64) / 1000;
            self.samples_played = frames * self.output_channels as u64;
            if let Some(ref mut resampler) = self.resampler {
                resampler.reset();
            }
            Ok(actual)
        } else {
            Err(AudioError::Playback("No active track to seek".to_string()))
        }
    }

    /// Begin a crossfade when the current track is within the fade window of its
    /// end and a preloaded next track exists. The old source keeps decoding as a
    /// fading-out overlay while the preloaded track becomes the new current source.
    /// Returns the new current track when a fade was started.
    fn maybe_start_crossfade(&mut self) -> Option<AudioTrack> {
        if self.fading_out.is_some()
            || !self.crossfade.enabled
            || self.crossfade.duration_ms == 0
            || self.next_preloaded.is_none()
            || self.output_sample_rate == 0
            || self.output_channels == 0
        {
            return None;
        }

        let duration_ms = self.current_duration_ms();
        if duration_ms == 0 {
            return None;
        }
        // Never fade over more than half of the outgoing track.
        let fade_ms = self.crossfade.duration_ms.min(duration_ms / 2);
        if fade_ms == 0 || self.current_position_ms() + fade_ms < duration_ms {
            return None;
        }

        let next = self.next_preloaded.take()?;
        let old_source = self.current_source.take()?;
        let old_resampler = self.resampler.take();
        let buffer = std::mem::take(&mut self.predecode_buffer);
        let offset = self.predecode_offset;
        self.predecode_offset = 0;

        let fade_total = ((self.output_sample_rate as u64 * fade_ms) / 1000)
            .saturating_mul(self.output_channels as u64)
            .max(1);
        self.fading_out = Some(FadingOutSource {
            source: old_source,
            resampler: old_resampler,
            buffer,
            offset,
            fade_pos: 0,
            fade_total,
            curve: self.crossfade.curve,
        });

        let track = next.track.clone();
        self.current_source = Some(next);
        self.samples_played = 0;
        self.update_resampler();
        Some(track)
    }

    /// Pull up to `wanted` samples from the fading-out source (decoding more as
    /// needed) into `fade_scratch`. Returns the number of samples produced.
    fn read_fading_samples(&mut self, wanted: usize) -> usize {
        let Self {
            fading_out,
            fade_scratch,
            ..
        } = self;
        let Some(fading) = fading_out.as_mut() else {
            return 0;
        };

        fade_scratch.clear();
        fade_scratch.resize(wanted, 0.0);
        let mut produced = 0;

        while produced < wanted {
            if fading.offset < fading.buffer.len() {
                let available = fading.buffer.len() - fading.offset;
                let to_copy = (wanted - produced).min(available);
                fade_scratch[produced..produced + to_copy]
                    .copy_from_slice(&fading.buffer[fading.offset..fading.offset + to_copy]);
                fading.offset += to_copy;
                produced += to_copy;
                if fading.offset == fading.buffer.len() {
                    fading.buffer.clear();
                    fading.offset = 0;
                }
                continue;
            }

            if !fading.source.predecoded_samples.is_empty() {
                let raw = std::mem::take(&mut fading.source.predecoded_samples);
                match fading.resampler.as_mut() {
                    Some(resampler) => resampler.resample(&raw, &mut fading.buffer),
                    None => fading.buffer.extend_from_slice(&raw),
                }
                continue;
            }

            match fading.source.decoder.decode_next_packet() {
                Ok(Some(packet)) => match fading.resampler.as_mut() {
                    Some(resampler) => resampler.resample(packet, &mut fading.buffer),
                    None => fading.buffer.extend_from_slice(packet),
                },
                // EOF or decode error on the dying track: stop pulling from it.
                Ok(None) | Err(_) => break,
            }
        }

        produced
    }

    /// Mix the fading-out source into `output` with the configured fade curve.
    fn apply_crossfade_mix(&mut self, output: &mut [f32]) {
        if output.is_empty() || self.fading_out.is_none() {
            return;
        }

        let produced = self.read_fading_samples(output.len());
        let Self {
            fading_out,
            fade_scratch,
            ..
        } = self;
        let Some(fading) = fading_out.as_mut() else {
            return;
        };

        let fade_total = fading.fade_total.max(1) as f32;
        for i in 0..produced {
            let progress = ((fading.fade_pos + i as u64) as f32 / fade_total).min(1.0);
            let (gain_out, gain_in) = CrossfadeProcessor::calculate_gains(progress, fading.curve);
            output[i] = output[i] * gain_in + fade_scratch[i] * gain_out;
        }
        fading.fade_pos += output.len() as u64;

        let fade_done = fading.fade_pos >= fading.fade_total;
        let old_track_ended = produced < output.len();
        if fade_done || old_track_ended {
            *fading_out = None;
        }
    }

    /// Read next output buffer of interleaved samples at output_sample_rate
    /// Returns: (number of samples written, Option<AudioTrack> if track changed gaplessly, bool is_eof)
    pub fn read_samples(
        &mut self,
        output: &mut [f32],
    ) -> AudioResult<(usize, Option<AudioTrack>, bool)> {
        let mut samples_written = 0;
        let mut track_transitioned = self.maybe_start_crossfade();

        let mut is_eof = false;
        while samples_written < output.len() {
            let needed = output.len() - samples_written;

            // First drain predecode buffer
            if self.predecode_offset < self.predecode_buffer.len() {
                let available = self.predecode_buffer.len() - self.predecode_offset;
                let to_copy = needed.min(available);
                output[samples_written..samples_written + to_copy].copy_from_slice(
                    &self.predecode_buffer[self.predecode_offset..self.predecode_offset + to_copy],
                );
                self.predecode_offset += to_copy;
                if self.predecode_offset == self.predecode_buffer.len() {
                    self.predecode_buffer.clear();
                    self.predecode_offset = 0;
                }
                samples_written += to_copy;
                self.samples_played += to_copy as u64;
                continue;
            }

            // If we have current source, decode more
            if let Some(ref mut source) = self.current_source {
                if !source.predecoded_samples.is_empty() {
                    let raw_samples = std::mem::take(&mut source.predecoded_samples);
                    if let Some(ref mut resampler) = self.resampler {
                        resampler.resample(&raw_samples, &mut self.predecode_buffer);
                    } else {
                        self.predecode_buffer.extend_from_slice(&raw_samples);
                    }
                    continue;
                }

                match source.decoder.decode_next_packet()? {
                    Some(packet) => {
                        if let Some(ref mut resampler) = self.resampler {
                            resampler.resample(packet, &mut self.predecode_buffer);
                        } else {
                            self.predecode_buffer.extend_from_slice(packet);
                        }
                    }
                    None => {
                        // EOF on current track
                        source.is_eof = true;
                        if let Some(next) = self.next_preloaded.take() {
                            track_transitioned = Some(next.track.clone());
                            self.samples_played = 0;
                            self.current_source = Some(next);
                            self.update_resampler();
                        } else {
                            self.current_source = None;
                            is_eof = true;
                            break;
                        }
                    }
                }
            } else {
                // No source and no preload
                is_eof = true;
                break;
            }
        }

        self.apply_crossfade_mix(&mut output[..samples_written]);
        Ok((samples_written, track_transitioned, is_eof))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resampler_identity() {
        let mut resampler = LinearResampler::new(44100, 44100, 2);
        assert!(resampler.is_identity());

        let input = vec![0.1, 0.2, 0.3, 0.4];
        let mut output = Vec::new();
        resampler.resample(&input, &mut output);
        assert_eq!(input, output);
    }

    #[test]
    fn test_resampler_upsample() {
        let mut resampler = LinearResampler::new(44100, 88200, 1);
        let input = vec![0.0, 1.0, 0.0];
        let mut output = Vec::new();
        resampler.resample(&input, &mut output);
        // Should produce approximately 2x samples
        assert!(output.len() >= 3);
    }
}

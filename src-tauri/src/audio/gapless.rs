use crate::audio::decoder::AudioDecoder;
use crate::audio::dto::{AudioTrack, QualityBadge, ReplayGainInfo};
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

/// Manages active playback source and preloading the next track for seamless gapless playback
pub struct GaplessController {
    current_source: Option<PreloadedTrack>,
    next_preloaded: Option<PreloadedTrack>,
    predecode_buffer: Vec<f32>,
    resampler: Option<LinearResampler>,
    output_sample_rate: u32,
    output_channels: u16,
    samples_played: u64,
}

impl GaplessController {
    pub fn new(output_sample_rate: u32, output_channels: u16) -> Self {
        Self {
            current_source: None,
            next_preloaded: None,
            predecode_buffer: Vec::with_capacity(8192),
            resampler: None,
            output_sample_rate,
            output_channels,
            samples_played: 0,
        }
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
        self.current_source = Some(preloaded);
        self.samples_played = 0;
        self.update_resampler();
        Ok(())
    }

    pub fn preload_next(&mut self, track: AudioTrack) -> AudioResult<()> {
        let preloaded = PreloadedTrack::open(track)?;
        self.next_preloaded = Some(preloaded);
        Ok(())
    }

    pub fn clear_preload(&mut self) {
        self.next_preloaded = None;
    }

    pub fn has_current(&self) -> bool {
        self.current_source.is_some()
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

    pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        if let Some(ref mut source) = self.current_source {
            let actual = source.decoder.seek(target_ms)?;
            source.predecoded_samples.clear();
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

    /// Read next output buffer of interleaved samples at output_sample_rate
    /// Returns: (number of samples written, Option<AudioTrack> if track changed gaplessly, bool is_eof)
    pub fn read_samples(
        &mut self,
        output: &mut [f32],
    ) -> AudioResult<(usize, Option<AudioTrack>, bool)> {
        let mut samples_written = 0;
        let mut track_transitioned = None;

        while samples_written < output.len() {
            let needed = output.len() - samples_written;

            // First drain predecode buffer
            if !self.predecode_buffer.is_empty() {
                let to_copy = needed.min(self.predecode_buffer.len());
                output[samples_written..samples_written + to_copy]
                    .copy_from_slice(&self.predecode_buffer[..to_copy]);
                self.predecode_buffer.drain(..to_copy);
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
                            return Ok((samples_written, track_transitioned, true));
                        }
                    }
                }
            } else {
                // No source and no preload
                return Ok((samples_written, track_transitioned, true));
            }
        }

        Ok((samples_written, track_transitioned, false))
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

use std::fs::File;
use std::path::{Path, PathBuf};

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, Track};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::{MetadataOptions, Tag, Value};
use symphonia::core::probe::Hint;
use symphonia::core::units::{Time, TimeBase};

use crate::audio::dto::{QualityBadge, ReplayGainInfo};
use crate::audio::error::{AudioError, AudioResult};

pub struct AudioDecoder {
    path: PathBuf,
    format_reader: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    sample_rate: u32,
    channels: u16,
    time_base: TimeBase,
    total_frames: Option<u64>,
    sample_buffer: Option<SampleBuffer<f32>>,
    quality_badge: QualityBadge,
    replay_gain_info: Option<ReplayGainInfo>,
}

impl AudioDecoder {
    pub fn open<P: AsRef<Path>>(path: P) -> AudioResult<Self> {
        let path_buf = path.as_ref().to_path_buf();
        let file = File::open(&path_buf).map_err(|e| AudioError::IoError {
            path: path_buf.clone(),
            source: e,
        })?;

        let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());

        let mut hint = Hint::new();
        if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
            hint.with_extension(ext);
        }

        let format_opts = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let metadata_opts = MetadataOptions::default();

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .map_err(|e| AudioError::UnsupportedFormat {
                path: path_buf.clone(),
                details: e.to_string(),
            })?;

        let mut format_reader = probed.format;

        // Find default audio track
        let track = format_reader
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
            .ok_or_else(|| AudioError::UnsupportedFormat {
                path: path_buf.clone(),
                details: "No valid audio track found".to_string(),
            })?
            .clone();

        let track_id = track.id;
        let codec_params = track.codec_params.clone();
        let sample_rate = codec_params.sample_rate.unwrap_or(44100);
        let channels = codec_params.channels.map(|c| c.count() as u16).unwrap_or(2);
        let time_base = codec_params
            .time_base
            .unwrap_or(TimeBase::new(1, sample_rate));
        let total_frames = codec_params.n_frames;

        let decoder_opts = DecoderOptions::default();
        let decoder = symphonia::default::get_codecs()
            .make(&codec_params, &decoder_opts)
            .map_err(|e| AudioError::DecodeError {
                path: path_buf.clone(),
                details: e.to_string(),
            })?;

        // Extract ReplayGain and QualityBadge
        let replay_gain_info = Self::extract_replay_gain(&mut format_reader);
        let quality_badge = Self::build_quality_badge(&path_buf, &track, sample_rate, channels);

        Ok(Self {
            path: path_buf,
            format_reader,
            decoder,
            track_id,
            sample_rate,
            channels,
            time_base,
            total_frames,
            sample_buffer: None,
            quality_badge,
            replay_gain_info,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn quality_badge(&self) -> &QualityBadge {
        &self.quality_badge
    }

    pub fn replay_gain_info(&self) -> Option<&ReplayGainInfo> {
        self.replay_gain_info.as_ref()
    }

    pub fn duration_ms(&self) -> u64 {
        if let Some(n_frames) = self.total_frames {
            let time = self.time_base.calc_time(n_frames);
            (time.seconds * 1000) + ((time.frac * 1000.0) as u64)
        } else {
            0
        }
    }

    pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        let seconds = target_ms / 1000;
        let frac = (target_ms % 1000) as f64 / 1000.0;
        let seek_time = Time::from(seconds as f64 + frac);

        let seek_to = SeekTo::Time {
            time: seek_time,
            track_id: Some(self.track_id),
        };

        match self.format_reader.seek(SeekMode::Accurate, seek_to) {
            Ok(seeked_to) => {
                self.decoder.reset();
                let actual_time = self.time_base.calc_time(seeked_to.actual_ts);
                let actual_ms = (actual_time.seconds * 1000) + ((actual_time.frac * 1000.0) as u64);
                Ok(actual_ms)
            }
            Err(e) => Err(AudioError::SeekError {
                target_ms,
                reason: e.to_string(),
            }),
        }
    }

    pub fn decode_next_packet(&mut self) -> AudioResult<Option<&[f32]>> {
        loop {
            let packet = match self.format_reader.next_packet() {
                Ok(packet) => packet,
                Err(SymphoniaError::IoError(e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    return Ok(None);
                }
                Err(SymphoniaError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(e) => {
                    return Err(AudioError::DecodeError {
                        path: self.path.clone(),
                        details: e.to_string(),
                    });
                }
            };

            if packet.track_id() != self.track_id {
                continue;
            }

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    let num_frames = decoded.frames();

                    if self.sample_buffer.is_none() {
                        let sample_buffer =
                            SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                        self.sample_buffer = Some(sample_buffer);
                    }

                    if let Some(ref mut buf) = self.sample_buffer {
                        buf.copy_interleaved_ref(decoded);
                        let slice = &buf.samples()[..num_frames * spec.channels.count()];
                        return Ok(Some(slice));
                    }
                }
                Err(SymphoniaError::DecodeError(e)) => {
                    // Non-fatal decode errors in streams can occur; continue reading next packet
                    tracing::warn!("Symphonia decode error: {}, skipping packet", e);
                    continue;
                }
                Err(e) => {
                    return Err(AudioError::DecodeError {
                        path: self.path.clone(),
                        details: e.to_string(),
                    });
                }
            }
        }
    }

    fn extract_replay_gain(format: &mut Box<dyn FormatReader>) -> Option<ReplayGainInfo> {
        let mut info = ReplayGainInfo::default();
        let mut found = false;

        let check_tag = |tag: &Tag, info: &mut ReplayGainInfo, found: &mut bool| {
            let key = tag.key.to_ascii_uppercase();
            let val_str = match &tag.value {
                Value::String(s) => s.as_str(),
                _ => return,
            };

            if key.contains("REPLAYGAIN_TRACK_GAIN") || key.contains("R128_TRACK_GAIN") {
                if let Some(db) = parse_db_string(val_str) {
                    info.track_gain_db = Some(db);
                    *found = true;
                }
            } else if key.contains("REPLAYGAIN_TRACK_PEAK") {
                if let Ok(peak) = val_str.trim().parse::<f32>() {
                    info.track_peak = Some(peak);
                    *found = true;
                }
            } else if key.contains("REPLAYGAIN_ALBUM_GAIN") || key.contains("R128_ALBUM_GAIN") {
                if let Some(db) = parse_db_string(val_str) {
                    info.album_gain_db = Some(db);
                    *found = true;
                }
            } else if key.contains("REPLAYGAIN_ALBUM_PEAK") {
                if let Ok(peak) = val_str.trim().parse::<f32>() {
                    info.album_peak = Some(peak);
                    *found = true;
                }
            }
        };

        if let Some(meta) = format.metadata().current() {
            for tag in meta.tags() {
                check_tag(tag, &mut info, &mut found);
            }
        }

        if found {
            Some(info)
        } else {
            None
        }
    }

    fn build_quality_badge(
        path: &Path,
        track: &Track,
        sample_rate: u32,
        channels: u16,
    ) -> QualityBadge {
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_lowercase();

        let codec_name = format!("{:?}", track.codec_params.codec).to_uppercase();
        let bit_depth = track.codec_params.bits_per_sample;
        let is_lossless = match ext.as_str() {
            "flac" | "wav" | "alac" | "aiff" | "pcm" => true,
            "mp3" | "ogg" | "aac" | "m4a" | "opus" | "wma" => false,
            _ => {
                codec_name.contains("FLAC")
                    || codec_name.contains("PCM")
                    || codec_name.contains("ALAC")
            }
        };

        let is_hi_res = QualityBadge::compute_is_hi_res(sample_rate, bit_depth);

        let bitrate_kbps = if let Some(bps) = track.codec_params.bits_per_coded_sample {
            Some((bps * sample_rate / 1000) as u32)
        } else {
            None
        };

        QualityBadge {
            sample_rate,
            channels,
            bit_depth,
            bitrate_kbps,
            codec_name,
            container_format: ext,
            is_lossless,
            is_hi_res,
        }
    }
}

pub fn parse_db_string(val: &str) -> Option<f32> {
    let clean = val
        .trim()
        .trim_end_matches("dB")
        .trim_end_matches("db")
        .trim_end_matches("LUFS")
        .trim();
    clean.parse::<f32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_db_string() {
        assert_eq!(parse_db_string("-6.50 dB"), Some(-6.50));
        assert_eq!(parse_db_string("+1.25 dB"), Some(1.25));
        assert_eq!(parse_db_string("-4.20"), Some(-4.20));
        assert_eq!(parse_db_string("0.0 dB"), Some(0.0));
        assert_eq!(parse_db_string("invalid"), None);
    }

    #[test]
    fn test_quality_badge_hi_res() {
        assert!(QualityBadge::compute_is_hi_res(96000, Some(24)));
        assert!(QualityBadge::compute_is_hi_res(88200, Some(16)));
        assert!(QualityBadge::compute_is_hi_res(44100, Some(24)));
        assert!(!QualityBadge::compute_is_hi_res(44100, Some(16)));
        assert!(!QualityBadge::compute_is_hi_res(48000, None));
    }
}

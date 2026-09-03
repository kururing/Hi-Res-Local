//! Streaming decoder backed by `nnpm-audio-core` (Symphonia + DSD adapter).

#![allow(clippy::manual_is_multiple_of)]

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use nnpm_audio_core::decimator::{dsd_decode_block_bytes, dsd_pcm_output_rate_hz};
use nnpm_audio_core::dsd::{parse_header, DsdEncoding};
use nnpm_audio_core::decoder::PcmDecoder;
use nnpm_audio_core::dsd::DsdSource;
use nnpm_audio_core::graph::{GraphConfig, ProcessingGraph};
use nnpm_audio_core::ndsd::NdsdSourceAdapter;
use nnpm_audio_core::source::MediaSource;
use nnpm_audio_core::DecodedSampleRepr;

use crate::audio::dto::{DsdOutputMode, DsdRate, QualityBadge, ReplayGainInfo};
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pcm::{AudioFormat, PcmSampleFormat};
use crate::audio::pcm_convert::{pack_container4_to_packed_s24, pack_packed_s24_to_container4};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BitPerfectPack {
    Identity,
    Container4ToPacked3,
    #[allow(dead_code)]
    Packed3ToContainer4,
}

struct BitPerfectWire {
    pack: BitPerfectPack,
}

enum Inner {
    Pcm(PcmDecoder),
    Dsd(DsdPcmSession),
}

struct DsdPcmSession {
    adapter: NdsdSourceAdapter,
    graph: ProcessingGraph,
    /// Integer FIR rate (176.4/192 kHz for DSD64). Graph input stays here.
    fir_rate: u32,
    /// Device / playback rate after Rubato.
    sample_rate: u32,
    channels: u16,
}

pub struct AudioDecoder {
    path: PathBuf,
    inner: Inner,
    quality_badge: QualityBadge,
    replay_gain_info: Option<ReplayGainInfo>,
    source_format: AudioFormat,
    bit_depth: u32,
    duration_ms: u64,
    channel_layout: String,
    bit_perfect_wire: Option<BitPerfectWire>,
    bytes_buf: Vec<u8>,
    pack_buf: Vec<u8>,
    f32_buf: Vec<f32>,
    pcm_graph: Option<ProcessingGraph>,
    output_sample_rate: u32,
    graph_flushed: bool,
    /// First packet decoded to prove the exact WASAPI wire representation.
    bit_perfect_primed: bool,
}

impl AudioDecoder {
    pub fn open<P: AsRef<Path>>(path: P) -> AudioResult<Self> {
        let path_ref = path.as_ref();
        let ext = path_ref
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if ext == "dsf" || ext == "dff" {
            let source = MediaSource::open_file(path_ref).map_err(map_core)?;
            return Self::from_dsd_source(path_ref.to_path_buf(), source);
        }
        let mut source = MediaSource::open_file(path_ref).map_err(map_core)?;
        if source.looks_like_dsd() {
            return Self::from_dsd_source(path_ref.to_path_buf(), source);
        }
        Self::from_pcm(path_ref.to_path_buf(), source)
    }

    pub fn open_track(track: &crate::audio::dto::AudioTrack) -> AudioResult<Self> {
        let mut decoder = if let Some(url) = track.stream_url.as_deref() {
            Self::open_url(url)?
        } else {
            Self::open(&track.path)?
        };
        decoder.replay_gain_info = track.replay_gain.clone();
        Ok(decoder)
    }

    pub fn open_pcm_track(track: &crate::audio::dto::AudioTrack) -> AudioResult<Self> {
        Self::open_track(track)
    }

    pub fn open_url(url: &str) -> AudioResult<Self> {
        crate::audio::http_input::validate_http_stream_url(url)?;
        let display = crate::audio::http_input::display_stream_path(url);
        let mut source = MediaSource::open_http(url).map_err(map_core)?;
        if source.looks_like_dsd() {
            let mut head = vec![0u8; 65_536];
            let n = source.read(&mut head).unwrap_or(0);
            head.truncate(n);
            let _ = source.seek(SeekFrom::Start(0));
            if parse_header(&head, source.len())
                .map(|format| format.encoding == DsdEncoding::Dst)
                .unwrap_or(false)
            {
                return Err(AudioError::Playback(
                    "DST over HTTP is not supported".to_string(),
                ));
            }
            return Self::from_dsd_source(display, source);
        }
        Self::from_pcm(display, source)
    }

    fn from_pcm(path: PathBuf, source: MediaSource) -> AudioResult<Self> {
        let decoder = PcmDecoder::open(source).map_err(map_core)?;
        let info = decoder.info().clone();
        let bit_depth = u32::from(info.bit_depth.unwrap_or(16));
        let source_format = match info.bit_depth.unwrap_or(16) {
            16 => AudioFormat::s16(info.sample_rate, info.channels),
            24 => AudioFormat::s24_in_32(info.sample_rate, info.channels),
            32 => AudioFormat::s32(info.sample_rate, info.channels),
            _ => AudioFormat::f32(info.sample_rate, info.channels),
        };
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_ascii_lowercase();
        let quality_badge = QualityBadge {
            sample_rate: info.sample_rate,
            channels: info.channels,
            bit_depth: info.bit_depth.map(u32::from),
            bitrate_kbps: info.bitrate_kbps,
            codec_name: info.codec.to_ascii_uppercase(),
            container_format: if ext.is_empty() {
                info.container.clone()
            } else {
                ext
            },
            is_lossless: info.lossless,
            is_hi_res: QualityBadge::compute_is_hi_res(
                info.sample_rate,
                info.bit_depth.map(u32::from),
            ),
            source_type: None,
            dsd_rate: None,
            dsd_output_mode: None,
        };
        Ok(Self {
            path,
            duration_ms: decoder.duration_ms(),
            inner: Inner::Pcm(decoder),
            quality_badge,
            replay_gain_info: None,
            source_format,
            bit_depth,
            bit_perfect_wire: None,
            bytes_buf: Vec::new(),
            pack_buf: Vec::new(),
            f32_buf: Vec::new(),
            pcm_graph: None,
            output_sample_rate: info.sample_rate,
            graph_flushed: false,
            bit_perfect_primed: false,
            channel_layout: info.channel_layout.unwrap_or_else(|| match info.channels {
                1 => "FRONT_LEFT".into(),
                2 => "FRONT_LEFT | FRONT_RIGHT".into(),
                n => format!("{n}ch"),
            }),
        })
    }

    fn from_dsd_source(path: PathBuf, source: MediaSource) -> AudioResult<Self> {
        let adapter = NdsdSourceAdapter::open(source).map_err(map_core)?;
        let format = adapter.format().clone();
        let fir_rate = dsd_pcm_output_rate_hz(format.dsd_sample_rate);
        if fir_rate == 0 {
            return Err(AudioError::UnsupportedFormat {
                path: path.clone(),
                details: format!("unsupported DSD sample rate {} Hz", format.dsd_sample_rate),
            });
        }
        let graph = ProcessingGraph::new(
            fir_rate,
            format.channels,
            GraphConfig {
                target_sample_rate: Some(fir_rate),
                ..GraphConfig::default()
            },
        )
        .map_err(map_core)?;
        let quality_badge = QualityBadge {
            sample_rate: format.dsd_sample_rate,
            channels: format.channels,
            bit_depth: Some(1),
            bitrate_kbps: Some(
                ((u64::from(format.dsd_sample_rate) * u64::from(format.channels)) / 1000) as u32,
            ),
            codec_name: if matches!(format.encoding, nnpm_audio_core::dsd::DsdEncoding::Dst) {
                "DST".into()
            } else {
                "DSD".into()
            },
            container_format: match format.container {
                nnpm_audio_core::dsd::DsdContainer::Dsf => "dsf".into(),
                nnpm_audio_core::dsd::DsdContainer::Dff => "dff".into(),
            },
            is_lossless: true,
            is_hi_res: true,
            source_type: Some("DSD".into()),
            dsd_rate: Some(map_dsd_rate_dto(format.dsd_rate)),
            dsd_output_mode: Some(DsdOutputMode::Pcm),
        };
        Ok(Self {
            path,
            duration_ms: format.duration_ms,
            inner: Inner::Dsd(DsdPcmSession {
                adapter,
                graph,
                fir_rate,
                sample_rate: fir_rate,
                channels: format.channels,
            }),
            quality_badge,
            replay_gain_info: None,
            source_format: AudioFormat::f32(fir_rate, format.channels),
            bit_depth: 1,
            bit_perfect_wire: None,
            bytes_buf: Vec::new(),
            pack_buf: Vec::new(),
            f32_buf: Vec::new(),
            pcm_graph: None,
            output_sample_rate: fir_rate,
            graph_flushed: false,
            bit_perfect_primed: false,
            channel_layout: match format.channels {
                1 => "FRONT_LEFT".into(),
                2 => "FRONT_LEFT | FRONT_RIGHT".into(),
                n => format!("{n}ch"),
            },
        })
    }

    pub fn sample_rate(&self) -> u32 {
        match &self.inner {
            Inner::Pcm(d) => d.sample_rate(),
            Inner::Dsd(d) => d.sample_rate,
        }
    }

    pub fn channels(&self) -> u16 {
        match &self.inner {
            Inner::Pcm(d) => d.channels(),
            Inner::Dsd(d) => d.channels,
        }
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
        self.duration_ms
    }

    pub fn source_format(&self) -> AudioFormat {
        self.source_format
    }

    pub fn bit_depth(&self) -> u32 {
        self.bit_depth
    }

    pub fn decoded_repr(&self) -> DecodedSampleRepr {
        match &self.inner {
            Inner::Pcm(d) => d.last_repr(),
            Inner::Dsd(_) => DecodedSampleRepr::F32,
        }
    }

    pub fn decoded_planar(&self) -> bool {
        true
    }

    pub fn channel_layout(&self) -> &str {
        &self.channel_layout
    }

    pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        let actual = match &mut self.inner {
            Inner::Pcm(d) => d.seek(target_ms).map_err(map_core)?,
            Inner::Dsd(d) => {
                let actual = d.adapter.seek_ms(target_ms).map_err(map_core)?;
                d.graph.reset_stream().map_err(map_core)?;
                actual
            }
        };
        self.graph_flushed = false;
        self.bit_perfect_primed = false;
        self.bytes_buf.clear();
        if self.pcm_graph.is_some() {
            self.rebuild_pcm_graph()?;
        }
        Ok(actual)
    }

    pub fn decode_next_packet(&mut self) -> AudioResult<Option<&[f32]>> {
        match &mut self.inner {
            Inner::Pcm(d) => loop {
                match d.decode_next().map_err(map_core)? {
                    Some(samples) => {
                        self.f32_buf = if let Some(graph) = self.pcm_graph.as_mut() {
                            graph.process_f32(samples)
                        } else {
                            samples.to_vec()
                        };
                        if !self.f32_buf.is_empty() {
                            return Ok(Some(self.f32_buf.as_slice()));
                        }
                    }
                    None => {
                        if !self.graph_flushed {
                            self.graph_flushed = true;
                            if let Some(graph) = self.pcm_graph.as_mut() {
                                self.f32_buf = graph.flush();
                                if !self.f32_buf.is_empty() {
                                    return Ok(Some(self.f32_buf.as_slice()));
                                }
                            }
                        }
                        return Ok(None);
                    }
                }
            },
            Inner::Dsd(session) => loop {
                match session
                    .adapter
                    .next_block(dsd_decode_block_bytes(
                        session.adapter.format().dsd_sample_rate,
                        session.channels,
                    ))
                    .map_err(map_core)?
                {
                    Some(block) => {
                        let rate = session.adapter.format().dsd_sample_rate;
                        self.f32_buf = session.graph.process_dsd_block(&block, rate);
                        tracing::debug!(target: "dsd", dsd_sample_rate = rate,
                            fir_rate = session.fir_rate,
                            pcm_sample_rate = session.sample_rate,
                            input_bytes = block.bytes.len(), output_samples = self.f32_buf.len(),
                            "DSD FIR block converted to f32 PCM");
                        if !self.f32_buf.is_empty() {
                            return Ok(Some(self.f32_buf.as_slice()));
                        }
                    }
                    None => {
                        if !self.graph_flushed {
                            self.graph_flushed = true;
                            self.f32_buf = session.graph.flush();
                            if !self.f32_buf.is_empty() {
                                return Ok(Some(self.f32_buf.as_slice()));
                            }
                        }
                        return Ok(None);
                    }
                }
            },
        }
    }

    pub fn decode_next_bytes(&mut self) -> AudioResult<Option<&[u8]>> {
        if matches!(self.inner, Inner::Dsd(_)) {
            return Err(AudioError::UnsupportedFormat {
                path: self.path.clone(),
                details: "DSD sources have no bit-perfect PCM wire".into(),
            });
        }
        if self.bit_perfect_primed {
            self.bit_perfect_primed = false;
        } else {
            let Some(_) = self.decode_next_packet()? else {
                return Ok(None);
            };
            if let Inner::Pcm(d) = &self.inner {
                let native = d.last_bytes();
                if native.is_empty() {
                    return Err(AudioError::FormatNotSupported {
                        requested: self.source_format.describe(),
                        details: format!(
                            "Decoded {:?} has no exact native PCM byte representation",
                            d.last_repr()
                        ),
                    });
                }
                self.bytes_buf.clear();
                self.bytes_buf.extend_from_slice(native);
            }
        }
        self.apply_bit_perfect_pack()?;
        Ok(Some(self.bytes_buf.as_slice()))
    }

    /// Decode and retain one packet before WASAPI negotiation. Metadata bit
    /// depth alone cannot distinguish integer PCM from IEEE float, nor the
    /// container width Symphonia actually emitted.
    pub fn prime_bit_perfect(&mut self) -> AudioResult<()> {
        if matches!(self.inner, Inner::Dsd(_)) {
            return Err(AudioError::FormatNotSupported {
                requested: "bit-perfect PCM wire".into(),
                details: "DSD sources require Native DSD or DoP".into(),
            });
        }
        if self.bit_perfect_primed {
            return Ok(());
        }
        if self.decode_next_packet()?.is_none() {
            return Err(AudioError::DecodeError {
                path: self.path.clone(),
                details: "Audio stream ended before its PCM representation could be verified"
                    .into(),
            });
        }
        let Inner::Pcm(decoder) = &self.inner else {
            unreachable!();
        };
        let repr = decoder.last_repr();
        let exact = exact_wire_format(
            repr,
            self.quality_badge.bit_depth,
            self.source_format.sample_rate,
            self.source_format.channels,
        )
        .ok_or_else(|| AudioError::FormatNotSupported {
            requested: format!("exact {:?} PCM wire", repr),
            details: format!(
                "Decoded representation {:?} / {:?}-bit has no lossless WASAPI mapping",
                repr, self.quality_badge.bit_depth
            ),
        })?;
        let native = decoder.last_bytes();
        let bytes_per_frame = exact.bytes_per_frame();
        if native.is_empty() || native.len() % bytes_per_frame != 0 {
            return Err(AudioError::FormatNotSupported {
                requested: exact.describe(),
                details: format!(
                    "Decoded {:?} produced {} bytes, not aligned to {}-byte frames",
                    repr,
                    native.len(),
                    bytes_per_frame
                ),
            });
        }
        self.source_format = exact;
        self.output_sample_rate = exact.sample_rate;
        self.bytes_buf.clear();
        self.bytes_buf.extend_from_slice(native);
        self.bit_perfect_primed = true;
        Ok(())
    }

    pub fn configure_bit_perfect_wire(
        &mut self,
        target: AudioFormat,
        packed_s24: bool,
        _container_bytes: usize,
    ) -> AudioResult<()> {
        if matches!(self.inner, Inner::Dsd(_)) {
            return Err(AudioError::UnsupportedFormat {
                path: self.path.clone(),
                details: "Bit-perfect wire is not available for DSD sources".into(),
            });
        }
        if !self.bit_perfect_primed || self.decoded_repr() == DecodedSampleRepr::Unknown {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: "Bit-perfect wire must be verified from a decoded packet first".into(),
            });
        }
        if self.source_format.sample_rate != target.sample_rate
            || self.source_format.channels != target.channels
        {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "Bit-perfect requires matching rate/channels (source {} Hz / {} ch)",
                    self.source_format.sample_rate, self.source_format.channels
                ),
            });
        }
        let pack = if self.source_format.sample_format != target.sample_format {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "Bit-perfect cannot convert {:?} to {:?} (source {})",
                    self.source_format.sample_format,
                    target.sample_format,
                    self.source_format.describe()
                ),
            });
        } else if target.sample_format == PcmSampleFormat::S24 && packed_s24 {
            BitPerfectPack::Container4ToPacked3
        } else {
            BitPerfectPack::Identity
        };
        self.bit_perfect_wire = Some(BitPerfectWire { pack });
        Ok(())
    }

    pub fn set_output_format(&mut self, target: Option<AudioFormat>) -> AudioResult<()> {
        self.bit_perfect_wire = None;
        self.graph_flushed = false;
        let target_rate = target
            .map(|format| format.sample_rate)
            .unwrap_or(self.source_format.sample_rate);
        if target_rate == 0 {
            return Err(AudioError::FormatNotSupported {
                requested: "0 Hz PCM output".into(),
                details: "Output sample rate must be greater than zero".into(),
            });
        }
        self.output_sample_rate = target_rate;
        match &mut self.inner {
            Inner::Pcm(_) => self.rebuild_pcm_graph(),
            Inner::Dsd(session) => {
                session.sample_rate = target_rate;
                session.graph = ProcessingGraph::new(
                    session.fir_rate,
                    session.channels,
                    GraphConfig {
                        target_sample_rate: Some(target_rate),
                        ..GraphConfig::default()
                    },
                )
                .map_err(map_core)?;
                Ok(())
            }
        }
    }

    pub fn playback_sample_rate(&self) -> u32 {
        self.output_sample_rate
    }

    pub fn playback_channels(&self) -> u16 {
        self.channels()
    }

    fn rebuild_pcm_graph(&mut self) -> AudioResult<()> {
        let input_rate = self.source_format.sample_rate;
        if self.output_sample_rate == input_rate {
            self.pcm_graph = None;
            return Ok(());
        }
        self.pcm_graph = Some(
            ProcessingGraph::new(
                input_rate,
                self.source_format.channels,
                GraphConfig {
                    target_sample_rate: Some(self.output_sample_rate),
                    target_bit_depth: self.bit_depth.min(u32::from(u16::MAX)) as u16,
                    ..GraphConfig::default()
                },
            )
            .map_err(map_core)?,
        );
        Ok(())
    }

    fn apply_bit_perfect_pack(&mut self) -> AudioResult<()> {
        let Some(wire) = self.bit_perfect_wire.as_ref() else {
            return Ok(());
        };
        match wire.pack {
            BitPerfectPack::Identity => Ok(()),
            BitPerfectPack::Container4ToPacked3 => {
                pack_container4_to_packed_s24(&self.bytes_buf, &mut self.pack_buf);
                std::mem::swap(&mut self.bytes_buf, &mut self.pack_buf);
                Ok(())
            }
            BitPerfectPack::Packed3ToContainer4 => {
                pack_packed_s24_to_container4(&self.bytes_buf, &mut self.pack_buf);
                std::mem::swap(&mut self.bytes_buf, &mut self.pack_buf);
                Ok(())
            }
        }
    }
}

fn exact_wire_format(
    repr: DecodedSampleRepr,
    logical_bits: Option<u32>,
    sample_rate: u32,
    channels: u16,
) -> Option<AudioFormat> {
    match repr {
        DecodedSampleRepr::S16 if logical_bits.unwrap_or(16) <= 16 => {
            Some(AudioFormat::s16(sample_rate, channels))
        }
        DecodedSampleRepr::S24 if logical_bits.is_some_and(|bits| bits > 16 && bits <= 24) => {
            Some(AudioFormat::s24_in_32(sample_rate, channels))
        }
        DecodedSampleRepr::S32 => match logical_bits {
            Some(bits) if bits <= 16 => Some(AudioFormat::s16(sample_rate, channels)),
            Some(bits) if bits <= 24 => Some(AudioFormat::s24_in_32(sample_rate, channels)),
            Some(bits) if bits <= 32 => Some(AudioFormat::s32(sample_rate, channels)),
            _ => None,
        },
        DecodedSampleRepr::F32 => Some(AudioFormat::f32(sample_rate, channels)),
        _ => None,
    }
}

fn map_core(error: nnpm_audio_core::CoreError) -> AudioError {
    AudioError::DecodeError {
        path: PathBuf::new(),
        details: error.to_string(),
    }
}

fn map_dsd_rate_dto(rate: nnpm_audio_core::types::DsdRate) -> DsdRate {
    match rate {
        nnpm_audio_core::types::DsdRate::Dsd64 => DsdRate::Dsd64,
        nnpm_audio_core::types::DsdRate::Dsd128 => DsdRate::Dsd128,
        nnpm_audio_core::types::DsdRate::Dsd256 => DsdRate::Dsd256,
        nnpm_audio_core::types::DsdRate::Dsd512 => DsdRate::Dsd512,
        nnpm_audio_core::types::DsdRate::Dsd1024 => DsdRate::Dsd1024,
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
    fn detects_explicit_mqa_encoder_metadata_without_false_positives() {
        assert!(nnpm_audio_core::mqa::is_mqa_metadata_tag(
            "MQAENCODER",
            "MQAEncode v1.1, 2.4.0+0"
        ));
        assert!(nnpm_audio_core::mqa::is_mqa_metadata_tag(
            "encoder",
            "MQAEncode v1.1, 2.4.0+0"
        ));
        assert!(!nnpm_audio_core::mqa::is_mqa_metadata_tag(
            "ENCODER",
            "reference libFLAC 1.4.3"
        ));
        assert!(!nnpm_audio_core::mqa::is_mqa_metadata_tag(
            "ORIGINALSAMPLERATE",
            "44100"
        ));
    }

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

    #[test]
    fn exact_wire_uses_decoded_representation_not_metadata_guess() {
        assert_eq!(
            exact_wire_format(DecodedSampleRepr::F32, Some(32), 44_100, 2),
            Some(AudioFormat::f32(44_100, 2))
        );
        assert_eq!(
            exact_wire_format(DecodedSampleRepr::S32, Some(20), 96_000, 2),
            Some(AudioFormat::s24_in_32(96_000, 2))
        );
        assert_eq!(
            exact_wire_format(DecodedSampleRepr::F64, Some(64), 192_000, 2),
            None
        );
        assert_eq!(
            exact_wire_format(DecodedSampleRepr::S32, None, 48_000, 2),
            None
        );
    }
}

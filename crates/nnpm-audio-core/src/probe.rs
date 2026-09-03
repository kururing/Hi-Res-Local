use std::io::{Read, Seek, SeekFrom};

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};

use crate::dsd::{parse_header, DsdEncoding};
use crate::error::{CoreError, CoreResult};
use crate::mqa::{MqaDetector, MqaInfo};
use crate::opus::looks_like_opus;
use crate::source::MediaSource;
use crate::types::{AudioInfo, DsdRate};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeReport {
    pub container: String,
    pub codec: String,
    pub duration_seconds: f64,
    pub sample_rate_hz: u32,
    pub bit_depth: Option<u16>,
    pub channels: u16,
    pub channel_layout: Option<String>,
    pub bitrate_kbps: Option<u32>,
    pub is_lossless: bool,
    pub hi_res: bool,
    pub dsd: bool,
    pub dsd_rate: Option<u32>,
    pub has_audio_stream: bool,
    pub has_attached_picture: bool,
    pub mqa: MqaInfo,
    pub tags: ProbeTags,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork_base64: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProbeTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track: Option<String>,
    pub disc: Option<String>,
    pub date: Option<String>,
    pub genre: Option<String>,
    pub replaygain_track_gain: Option<String>,
    pub replaygain_track_peak: Option<String>,
    pub replaygain_album_gain: Option<String>,
    pub replaygain_album_peak: Option<String>,
    pub lyrics: Option<String>,
    pub encoder: Option<String>,
    pub originalsamplerate: Option<String>,
}

pub struct AudioProbe;

impl AudioProbe {
    pub fn inspect(source: &mut MediaSource) -> CoreResult<ProbeReport> {
        source.seek(SeekFrom::Start(0))?;
        let mut magic = [0u8; 12];
        let n = source.read(&mut magic)?;
        source.seek(SeekFrom::Start(0))?;
        if n >= 4 && (&magic[..4] == b"DSD " || &magic[..4] == b"FRM8") {
            return probe_dsd(source);
        }
        let bytes_head = {
            let mut buf = vec![0u8; 64 * 1024];
            let n = source.read(&mut buf)?;
            buf.truncate(n);
            buf
        };
        source.seek(SeekFrom::Start(0))?;
        if looks_like_opus(&bytes_head) || magic.get(0..4) == Some(&b"OggS"[..]) {
            if looks_like_opus(&bytes_head) {
                // Continue through Symphonia; Opus identification is recorded even if decode is limited.
            }
        }
        probe_with_lofty_and_symphonia(source)
    }
}

fn probe_dsd(source: &mut MediaSource) -> CoreResult<ProbeReport> {
    const HEAD: usize = 256 * 1024;
    let file_len = source.len();
    source.seek(SeekFrom::Start(0))?;
    let mut head = vec![0u8; HEAD];
    let n = source.read(&mut head)?;
    head.truncate(n);
    let format = parse_header(&head, file_len)?;
    let codec = if format.encoding == DsdEncoding::Dst {
        "dsd"
    } else {
        "dsd"
    };
    let container = match format.container {
        crate::dsd::DsdContainer::Dsf => "dsf",
        crate::dsd::DsdContainer::Dff => "dff",
    };
    Ok(ProbeReport {
        container: container.into(),
        codec: codec.into(),
        duration_seconds: format.duration_ms as f64 / 1000.0,
        sample_rate_hz: format.dsd_sample_rate,
        bit_depth: Some(1),
        channels: format.channels,
        channel_layout: None,
        bitrate_kbps: Some(
            ((u64::from(format.dsd_sample_rate) * u64::from(format.channels)) / 1000) as u32,
        ),
        is_lossless: true,
        hi_res: true,
        dsd: true,
        dsd_rate: Some(format.dsd_rate.multiplier()),
        has_audio_stream: true,
        has_attached_picture: false,
        mqa: MqaInfo::none(),
        tags: ProbeTags::default(),
        artwork_base64: None,
    })
}

fn probe_with_lofty_and_symphonia(source: &mut MediaSource) -> CoreResult<ProbeReport> {
    let path = source.path().map(|p| p.to_path_buf());
    let bytes = if path.is_none() {
        Some(source.read_all()?)
    } else {
        None
    };

    let tagged = if let Some(path) = path.as_ref() {
        Probe::open(path).ok().and_then(|p| p.read().ok())
    } else {
        None
    };

    let mut tags = ProbeTags::default();
    let mut artwork_base64 = None;
    let mut has_picture = false;
    if let Some(file) = tagged.as_ref() {
        if let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) {
            tags.title = tag.title().map(|s| s.to_string());
            tags.artist = tag.artist().map(|s| s.to_string());
            tags.album = tag.album().map(|s| s.to_string());
            tags.album_artist = tag
                .get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string());
            tags.track = tag.track().map(|n| n.to_string());
            tags.disc = tag.disk().map(|n| n.to_string());
            tags.date = tag.year().map(|y| y.to_string());
            tags.genre = tag.genre().map(|s| s.to_string());
            tags.lyrics = tag
                .get_string(&lofty::tag::ItemKey::Lyrics)
                .map(|s| s.to_string());
            tags.replaygain_track_gain = tag
                .get_string(&lofty::tag::ItemKey::ReplayGainTrackGain)
                .map(|s| s.to_string());
            tags.replaygain_track_peak = tag
                .get_string(&lofty::tag::ItemKey::ReplayGainTrackPeak)
                .map(|s| s.to_string());
            tags.replaygain_album_gain = tag
                .get_string(&lofty::tag::ItemKey::ReplayGainAlbumGain)
                .map(|s| s.to_string());
            tags.replaygain_album_peak = tag
                .get_string(&lofty::tag::ItemKey::ReplayGainAlbumPeak)
                .map(|s| s.to_string());
            if let Some(pic) = tag.pictures().first() {
                has_picture = true;
                artwork_base64 = Some(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    pic.data(),
                ));
            }
            for item in tag.items() {
                if matches!(
                    item.key(),
                    lofty::tag::ItemKey::EncoderSoftware | lofty::tag::ItemKey::EncoderSettings
                ) {
                    if let lofty::tag::ItemValue::Text(val) = item.value() {
                        tags.encoder = Some(val.clone());
                    }
                }
                if let lofty::tag::ItemKey::Unknown(key) = item.key() {
                    if key.eq_ignore_ascii_case("ORIGINALSAMPLERATE")
                        || key.eq_ignore_ascii_case("MQAENCODER")
                    {
                        if let lofty::tag::ItemValue::Text(val) = item.value() {
                            if key.eq_ignore_ascii_case("ORIGINALSAMPLERATE") {
                                tags.originalsamplerate = Some(val.clone());
                            }
                            if key.eq_ignore_ascii_case("MQAENCODER") {
                                tags.encoder = Some(val.clone());
                            }
                        }
                    }
                }
            }
        }
        let props = file.properties();
        let duration = props.duration();
        let duration_seconds = duration.as_secs_f64();
        if duration_seconds <= 0.0 {
            return Err(CoreError::Probe("Duration from probe was invalid.".into()));
        }
        let sample_rate_hz = props.sample_rate().unwrap_or(0);
        let channels = props.channels().unwrap_or(0);
        if sample_rate_hz == 0 {
            return Err(CoreError::Probe(
                "Sample rate from probe was invalid.".into(),
            ));
        }
        if channels == 0 {
            return Err(CoreError::Probe(
                "Channel count from probe was invalid.".into(),
            ));
        }
        let bit_depth = props.bit_depth().map(|b| u16::from(b));
        let (container, codec) = infer_format(path.as_deref(), bytes.as_deref());
        if !supported(&codec, &container) {
            return Err(CoreError::Probe(format!(
                "Unsupported audio format {codec}/{container}."
            )));
        }
        let lossless = matches!(codec.as_str(), "flac" | "alac" | "pcm" | "dsd");
        let hi_res = lossless && (sample_rate_hz > 48_000 || bit_depth.unwrap_or(0) > 16);
        let mut tag_pairs: Vec<(String, String)> = Vec::new();
        if let Some(enc) = &tags.encoder {
            tag_pairs.push(("ENCODER".into(), enc.clone()));
        }
        if let Some(orig) = &tags.originalsamplerate {
            tag_pairs.push(("ORIGINALSAMPLERATE".into(), orig.clone()));
        }
        let pairs: Vec<(&str, &str)> = tag_pairs
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        if let Some(ref data) = bytes {
            *source = MediaSource::from_bytes(source.label(), data.clone());
        } else {
            source.seek(SeekFrom::Start(0))?;
        }
        let mqa = MqaDetector::detect(source, &pairs)?;
        return Ok(ProbeReport {
            container,
            codec,
            duration_seconds,
            sample_rate_hz,
            bit_depth,
            channels: channels as u16,
            channel_layout: None,
            bitrate_kbps: props.audio_bitrate(),
            is_lossless: lossless,
            hi_res,
            dsd: false,
            dsd_rate: None,
            has_audio_stream: true,
            has_attached_picture: has_picture,
            mqa,
            tags,
            artwork_base64,
        });
    }

    probe_symphonia_only(source, bytes)
}

fn probe_symphonia_only(
    source: &mut MediaSource,
    preloaded: Option<Vec<u8>>,
) -> CoreResult<ProbeReport> {
    use std::io::Cursor;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::probe::Hint;

    let data = match preloaded {
        Some(d) => d,
        None => source.read_all()?,
    };
    let mss = MediaSourceStream::new(Box::new(Cursor::new(data.clone())), Default::default());
    let mut hint = Hint::new();
    if let Some(path) = source.path() {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .map_err(|e| CoreError::Probe(e.to_string()))?;
    let track = probed
        .format
        .default_track()
        .ok_or_else(|| CoreError::Probe("No audio stream was found.".into()))?;
    let codec_params = &track.codec_params;
    let sample_rate_hz = codec_params
        .sample_rate
        .ok_or_else(|| CoreError::Probe("Sample rate from probe was invalid.".into()))?;
    let channels = codec_params.channels.map(|c| c.count() as u16).unwrap_or(0);
    if channels == 0 {
        return Err(CoreError::Probe(
            "Channel count from probe was invalid.".into(),
        ));
    }
    let duration_seconds = codec_params
        .n_frames
        .map(|n| n as f64 / f64::from(sample_rate_hz))
        .unwrap_or(0.0);
    if duration_seconds <= 0.0 {
        return Err(CoreError::Probe("Duration from probe was invalid.".into()));
    }
    let (container, codec) = infer_from_symphonia(source.path(), &data, codec_params);
    if !supported(&codec, &container) {
        return Err(CoreError::Probe(format!(
            "Unsupported audio format {codec}/{container}."
        )));
    }
    let lossless = matches!(codec.as_str(), "flac" | "alac" | "pcm" | "dsd");
    Ok(ProbeReport {
        container,
        codec,
        duration_seconds,
        sample_rate_hz,
        bit_depth: codec_params.bits_per_sample.map(|b| b as u16),
        channels,
        channel_layout: None,
        bitrate_kbps: None,
        is_lossless: lossless,
        hi_res: lossless
            && (sample_rate_hz > 48_000 || codec_params.bits_per_sample.unwrap_or(0) > 16),
        dsd: false,
        dsd_rate: None,
        has_audio_stream: true,
        has_attached_picture: false,
        mqa: MqaInfo::none(),
        tags: ProbeTags::default(),
        artwork_base64: None,
    })
}

fn infer_format(path: Option<&std::path::Path>, bytes: Option<&[u8]>) -> (String, String) {
    let ext = path
        .and_then(|p| p.extension())
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let head = match bytes {
        Some(data) => data.get(..16).unwrap_or(data).to_vec(),
        None => read_magic(path),
    };
    if looks_like_opus(&head) || looks_like_opus(bytes.unwrap_or(&[])) {
        let container = if ext == "opus" { "opus" } else { "ogg" };
        return (container.into(), "opus".into());
    }
    if let Some((container, codec)) = infer_from_magic(&head) {
        return (container.into(), codec.into());
    }
    let (container, codec) = match ext.as_str() {
        "flac" => ("flac", "flac"),
        "wav" | "wave" => ("wav", "pcm"),
        "aiff" | "aif" => ("aiff", "pcm"),
        "mp3" => ("mp3", "mp3"),
        "m4a" | "mp4" => ("m4a", "aac"),
        "aac" => ("m4a", "aac"),
        "ogg" | "oga" => ("ogg", "vorbis"),
        "opus" => ("opus", "opus"),
        "webm" => ("webm", "opus"),
        "dsf" => ("dsf", "dsd"),
        "dff" => ("dff", "dsd"),
        _ => ("wav", "pcm"),
    };
    (container.into(), codec.into())
}

fn read_magic(path: Option<&std::path::Path>) -> Vec<u8> {
    let Some(path) = path else {
        return Vec::new();
    };
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let mut buf = [0u8; 16];
    match file.read(&mut buf) {
        Ok(n) => buf[..n].to_vec(),
        Err(_) => Vec::new(),
    }
}

fn infer_from_magic(head: &[u8]) -> Option<(&'static str, &'static str)> {
    if head.len() >= 4 && &head[..4] == b"fLaC" {
        return Some(("flac", "flac"));
    }
    if head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WAVE" {
        return Some(("wav", "pcm"));
    }
    if head.len() >= 4 && &head[..4] == b"FORM" {
        return Some(("aiff", "pcm"));
    }
    if head.len() >= 3 && &head[..3] == b"ID3" {
        return Some(("mp3", "mp3"));
    }
    if head.len() >= 2 && head[0] == 0xff && (head[1] & 0xe0) == 0xe0 {
        return Some(("mp3", "mp3"));
    }
    if head.len() >= 8 && &head[4..8] == b"ftyp" {
        return Some(("m4a", "aac"));
    }
    if head.len() >= 4 && &head[..4] == b"OggS" {
        return Some(("ogg", "vorbis"));
    }
    if head.len() >= 4 && &head[..4] == b"DSD " {
        return Some(("dsf", "dsd"));
    }
    if head.len() >= 4 && &head[..4] == b"FRM8" {
        return Some(("dff", "dsd"));
    }
    None
}

fn infer_from_symphonia(
    path: Option<&std::path::Path>,
    data: &[u8],
    params: &symphonia::core::codecs::CodecParameters,
) -> (String, String) {
    let ext = path
        .and_then(|p| p.extension())
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if looks_like_opus(data) || ext == "opus" {
        let container = if ext == "opus" { "opus" } else { "ogg" };
        return (container.into(), "opus".into());
    }
    let codec_name = format!("{:?}", params.codec).to_ascii_lowercase();
    let codec = if codec_name.contains("flac") {
        "flac"
    } else if codec_name.contains("mp3") || codec_name.contains("mpeg") {
        "mp3"
    } else if codec_name.contains("aac") {
        "aac"
    } else if codec_name.contains("alac") {
        "alac"
    } else if codec_name.contains("vorbis") {
        "vorbis"
    } else if codec_name.contains("pcm") || codec_name.contains("pcm") {
        "pcm"
    } else {
        "pcm"
    };
    let container = match ext.as_str() {
        "flac" => "flac",
        "wav" | "wave" => "wav",
        "aiff" | "aif" => "aiff",
        "mp3" => "mp3",
        "m4a" | "mp4" | "aac" => "m4a",
        "ogg" | "oga" => "ogg",
        "opus" => "opus",
        "webm" => "webm",
        _ => match codec {
            "flac" => "flac",
            "mp3" => "mp3",
            "aac" | "alac" => "m4a",
            "vorbis" | "opus" => "ogg",
            _ => "wav",
        },
    };
    (container.into(), codec.into())
}

pub fn supported(codec: &str, container: &str) -> bool {
    matches!(
        (codec, container),
        ("flac", "flac")
            | ("alac", "m4a")
            | ("pcm", "wav")
            | ("pcm", "aiff")
            | ("mp3", "mp3")
            | ("aac", "m4a")
            | ("opus", "ogg")
            | ("opus", "webm")
            | ("opus", "opus")
            | ("vorbis", "ogg")
            | ("dsd", "dsf")
            | ("dsd", "dff")
    )
}

impl ProbeReport {
    pub fn to_audio_info(&self) -> AudioInfo {
        AudioInfo {
            container: self.container.clone(),
            codec: self.codec.clone(),
            duration_ms: (self.duration_seconds * 1000.0) as u64,
            sample_rate: self.sample_rate_hz,
            bit_depth: self.bit_depth,
            channels: self.channels,
            channel_layout: self.channel_layout.clone(),
            bitrate_kbps: self.bitrate_kbps,
            lossless: self.is_lossless,
            hi_res: self.hi_res,
            dsd_rate: self.dsd_rate.and_then(|r| match r {
                64 => Some(DsdRate::Dsd64),
                128 => Some(DsdRate::Dsd128),
                256 => Some(DsdRate::Dsd256),
                512 => Some(DsdRate::Dsd512),
                1024 => Some(DsdRate::Dsd1024),
                _ => None,
            }),
            lsb_first: false,
        }
    }
}

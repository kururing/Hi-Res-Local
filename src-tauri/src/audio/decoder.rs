//! FFmpeg-based streaming audio decoder (`ffmpeg-next` 9.x).
//!
//! Provides interleaved f32 samples for the DSP / gapless path and optional
//! raw PCM bytes for bit-perfect WASAPI Exclusive output.

#![allow(clippy::manual_is_multiple_of)] // Keep compatibility with the project's Rust 1.80 MSRV.

use std::path::{Path, PathBuf};
use std::sync::Once;

use ffmpeg::channel_layout::ChannelLayout;
use ffmpeg::codec::{self, decoder, packet::Packet};
use ffmpeg::format::sample::{Sample as AvSample, Type as SampleType};
use ffmpeg::software::resampling;
use ffmpeg::util::error::{Error as FfError, EAGAIN};
use ffmpeg::{format, frame, media, rescale, Rational, Rescale};
use ffmpeg_next as ffmpeg;

use crate::audio::dsd::{DsdEncoding, DsdiffReader, DsfReader};
use crate::audio::dto::{DsdOutputMode, QualityBadge, ReplayGainInfo};
use crate::audio::error::{AudioError, AudioResult};
use crate::audio::pcm::{AudioFormat, PcmSampleFormat};
use crate::audio::pcm_convert::{pack_container4_to_packed_s24, pack_packed_s24_to_container4};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BitPerfectPack {
    Identity,
    /// Decoder 4-byte container → packed 3-byte S24.
    Container4ToPacked3,
    /// Packed 3-byte S24 → WASAPI 24-in-32.
    Packed3ToContainer4,
}

struct BitPerfectWire {
    target: AudioFormat,
    packed_s24: bool,
    container_bytes: usize,
    pack: BitPerfectPack,
}

static FFMPEG_INIT: Once = Once::new();

fn ensure_ffmpeg() {
    FFMPEG_INIT.call_once(|| {
        #[cfg(windows)]
        prepare_ffmpeg_dll_search();
        let _ = ffmpeg::init();
    });
}

/// Windows loads avcodec/avformat/avutil/swresample via the DLL search path.
/// Packaged Tauri resources are not always next to the exe (`vendor/ffmpeg/bin`
/// or flattened into the resource dir), so we AddDllDirectory / SetDllDirectory
/// before `ffmpeg::init()`.
#[cfg(windows)]
fn prepare_ffmpeg_dll_search() {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{
        AddDllDirectory, SetDefaultDllDirectories, SetDllDirectoryW,
        LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_USER_DIRS,
    };

    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("resources"));
            dirs.push(
                parent
                    .join("resources")
                    .join("vendor")
                    .join("ffmpeg")
                    .join("bin"),
            );
            dirs.push(parent.join("vendor").join("ffmpeg").join("bin"));
        }
    }
    dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("vendor")
            .join("ffmpeg")
            .join("bin"),
    );

    unsafe {
        let _ = SetDefaultDllDirectories(
            LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_USER_DIRS,
        );
    }

    let mut preferred: Option<Vec<u16>> = None;
    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        let wide: Vec<u16> = dir
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let _ = AddDllDirectory(PCWSTR(wide.as_ptr()));
        }
        let has_avcodec = std::fs::read_dir(&dir)
            .ok()
            .map(|rd| {
                rd.flatten().any(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .to_ascii_lowercase()
                        .starts_with("avcodec")
                })
            })
            .unwrap_or(false);
        if has_avcodec && preferred.is_none() {
            preferred = Some(wide);
        }
    }
    if let Some(wide) = preferred {
        unsafe {
            let _ = SetDllDirectoryW(PCWSTR(wide.as_ptr()));
        }
    }
}

struct FfmpegAudioDecoder {
    path: PathBuf,
    ictx: format::context::Input,
    decoder: decoder::Audio,
    stream_index: usize,
    sample_rate: u32,
    channels: u16,
    /// Native decoder sample format (may be planar).
    source_av_format: AvSample,
    channel_layout: ChannelLayout,
    source_format: AudioFormat,
    bit_depth: u32,
    duration_ms: u64,
    quality_badge: QualityBadge,
    replay_gain_info: Option<ReplayGainInfo>,
    /// Target exclusive / convert format. `None` → bit-perfect native path.
    output_target: Option<AudioFormat>,
    swr: Option<resampling::Context>,
    decoded_frame: frame::Audio,
    converted_frame: frame::Audio,
    f32_buf: Vec<f32>,
    bytes_buf: Vec<u8>,
    pack_buf: Vec<u8>,
    eof_sent: bool,
    finished: bool,
    /// True when codecpar had no usable sample format yet (fill from first frame).
    pending_format: bool,
    bit_perfect_wire: Option<BitPerfectWire>,
}

/// DSF/DFF adapter: the bundled FFmpeg build has no DFF demuxer, and feeding
/// DSF as interleaved `DSD_MSBF` across several file blocks is not what
/// `dsfdec` does. DSF packets are one physical block of channel-planar
/// LSB/MSB bytes (`DSD_LSBF_PLANAR` / `DSD_MSBF_PLANAR`). DFF raw stays
/// interleaved MSB (`DSD_MSBF`); DST stays on FFmpeg's DST decoder.
enum DsdInput {
    Dsf(DsfReader),
    Dff(DsdiffReader),
}

impl DsdInput {
    fn next_packet(&mut self, max_bytes: usize) -> crate::audio::dsd::DsdResult<Option<Vec<u8>>> {
        match self {
            Self::Dsf(reader) => reader.next_planar_block(),
            Self::Dff(reader) => reader.next_packet(max_bytes),
        }
    }

    fn seek_ms(&mut self, target_ms: u64) {
        match self {
            Self::Dsf(reader) => reader.seek_ms(target_ms),
            Self::Dff(reader) => reader.seek_ms(target_ms),
        }
    }
}

struct DsdAudioDecoder {
    path: PathBuf,
    reader: DsdInput,
    decoder: decoder::Audio,
    decoded_frame: frame::Audio,
    converted_frame: frame::Audio,
    f32_buf: Vec<f32>,
    bytes_buf: Vec<u8>,
    finished: bool,
    eof_sent: bool,
    format: AudioFormat,
    output_target: Option<AudioFormat>,
    swr: Option<resampling::Context>,
    quality_badge: QualityBadge,
    duration_ms: u64,
}

impl DsdAudioDecoder {
    fn open(path: &Path) -> AudioResult<Self> {
        ensure_ffmpeg();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let (reader, dsd_format, codec_id) = if extension == "dsf" {
            let reader = DsfReader::open(path).map_err(|e| AudioError::UnsupportedFormat {
                path: path.to_path_buf(),
                details: e.to_string(),
            })?;
            let format = reader.format.clone();
            let codec_id = if format.lsb_first {
                codec::Id::DSD_LSBF_PLANAR
            } else {
                codec::Id::DSD_MSBF_PLANAR
            };
            (DsdInput::Dsf(reader), format, codec_id)
        } else {
            let reader = DsdiffReader::open(path).map_err(|e| AudioError::UnsupportedFormat {
                path: path.to_path_buf(),
                details: e.to_string(),
            })?;
            let format = reader.format.clone();
            let codec_id = match format.encoding {
                DsdEncoding::Raw => codec::Id::DSD_MSBF,
                DsdEncoding::Dst => codec::Id::DST,
            };
            (DsdInput::Dff(reader), format, codec_id)
        };
        let codec = decoder::find(codec_id).ok_or_else(|| AudioError::UnsupportedFormat {
            path: path.to_path_buf(),
            details: format!("Bundled FFmpeg has no {:?} decoder", codec_id),
        })?;
        let mut context = codec::context::Context::new_with_codec(codec);
        let channels = i32::from(dsd_format.channels.max(1));
        unsafe {
            (*context.as_mut_ptr()).sample_rate = dsd_format.pcm_sample_rate as i32;
            (*context.as_mut_ptr()).ch_layout = ChannelLayout::default(channels).into();
        }
        let decoder = context
            .decoder()
            .open_as(codec)
            .map_err(|e| AudioError::DecodeError {
                path: path.to_path_buf(),
                details: e.to_string(),
            })?
            .audio()
            .map_err(|e| AudioError::DecodeError {
                path: path.to_path_buf(),
                details: e.to_string(),
            })?;

        let quality_badge = dsd_format.quality_badge(DsdOutputMode::Pcm);

        Ok(Self {
            path: path.to_path_buf(),
            reader,
            decoder,
            decoded_frame: frame::Audio::empty(),
            converted_frame: frame::Audio::empty(),
            f32_buf: Vec::with_capacity(16_384),
            bytes_buf: Vec::with_capacity(64 * 1024),
            finished: false,
            eof_sent: false,
            format: AudioFormat::f32(dsd_format.pcm_sample_rate, dsd_format.channels),
            output_target: None,
            swr: None,
            duration_ms: dsd_format.duration_ms,
            quality_badge,
        })
    }

    fn pull_frame(&mut self) -> AudioResult<Option<()>> {
        loop {
            match self.decoder.receive_frame(&mut self.decoded_frame) {
                Ok(()) => return Ok(Some(())),
                Err(FfError::Eof) => {
                    self.finished = true;
                    return Ok(None);
                }
                Err(FfError::Other { errno }) if errno == EAGAIN => {}
                Err(FfError::InvalidData) => continue,
                Err(e) => {
                    return Err(AudioError::DecodeError {
                        path: self.path.clone(),
                        details: e.to_string(),
                    });
                }
            }

            if self.finished {
                return Ok(None);
            }
            match self
                .reader
                .next_packet(32 * 1024)
                .map_err(|e| AudioError::DecodeError {
                    path: self.path.clone(),
                    details: e.to_string(),
                })? {
                Some(bytes) => {
                    let packet = Packet::copy(&bytes);
                    match self.decoder.send_packet(&packet) {
                        Ok(()) => {}
                        Err(FfError::Other { errno }) if errno == EAGAIN => {}
                        Err(e) => {
                            return Err(AudioError::DecodeError {
                                path: self.path.clone(),
                                details: e.to_string(),
                            });
                        }
                    }
                }
                None if !self.eof_sent => {
                    self.decoder
                        .send_eof()
                        .map_err(|e| AudioError::DecodeError {
                            path: self.path.clone(),
                            details: e.to_string(),
                        })?;
                    self.eof_sent = true;
                }
                None => {
                    self.finished = true;
                    return Ok(None);
                }
            }
        }
    }

    fn decode_next_packet(&mut self) -> AudioResult<Option<&[f32]>> {
        loop {
            match self.pull_frame()? {
                Some(()) => {
                    if self.output_target.is_some() {
                        self.ensure_swr()?;
                        self.converted_frame = frame::Audio::empty();
                        if let Some(swr) = self.swr.as_mut() {
                            swr.run(&self.decoded_frame, &mut self.converted_frame)
                                .map_err(|e| AudioError::DecodeError {
                                    path: self.path.clone(),
                                    details: format!("DSD PCM resampler: {e}"),
                                })?;
                        }
                        if self.converted_frame.samples() == 0 {
                            continue;
                        }
                        frame_to_f32(&self.converted_frame, &mut self.f32_buf)?;
                    } else {
                        frame_to_f32(&self.decoded_frame, &mut self.f32_buf)?;
                    }
                    attenuate_dsd_pcm(&mut self.f32_buf);
                    if self.f32_buf.is_empty() {
                        continue;
                    }
                    return Ok(Some(&self.f32_buf));
                }
                None => return Ok(None),
            }
        }
    }

    fn ensure_swr(&mut self) -> AudioResult<()> {
        let Some(target) = self.output_target else {
            self.swr = None;
            return Ok(());
        };
        if target.sample_rate == self.format.sample_rate {
            self.swr = None;
            return Ok(());
        }
        if self.swr.is_some() {
            return Ok(());
        }

        let source_layout = if self.decoded_frame.channel_layout().is_empty() {
            ChannelLayout::default(i32::from(self.format.channels.max(1)))
        } else {
            self.decoded_frame.channel_layout()
        };
        let target_layout = ChannelLayout::default(i32::from(self.format.channels.max(1)));
        let mut options = ffmpeg::Dictionary::new();
        // Steep anti-image so shaped DSD noise above ~20 kHz is not folded
        // back in when dropping from 352.8 kHz to 88.2/48 kHz.
        options.set("filter_size", "64");
        options.set("phase_shift", "10");
        options.set("cutoff", "0.905");
        self.swr = Some(
            resampling::Context::get_with(
                self.decoded_frame.format(),
                source_layout,
                self.format.sample_rate,
                AvSample::F32(SampleType::Packed),
                target_layout,
                target.sample_rate,
                options,
            )
            .map_err(|e| AudioError::DecodeError {
                path: self.path.clone(),
                details: format!("Failed to create DSD PCM resampler: {e}"),
            })?,
        );
        Ok(())
    }

    fn decode_next_bytes(&mut self) -> AudioResult<Option<&[u8]>> {
        let samples = match self.decode_next_packet()? {
            Some(samples) => samples.to_vec(),
            None => return Ok(None),
        };
        {
            crate::audio::pcm_convert::f32_to_pcm_bytes(
                &samples,
                &self.format,
                false,
                &mut self.bytes_buf,
            );
        }
        Ok(Some(&self.bytes_buf))
    }

    fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        self.reader.seek_ms(target_ms);
        self.decoder.flush();
        self.swr = None;
        self.converted_frame = frame::Audio::empty();
        self.finished = false;
        self.eof_sent = false;
        self.f32_buf.clear();
        self.bytes_buf.clear();
        Ok(target_ms.min(self.duration_ms))
    }

    fn set_output_format(&mut self, target: Option<AudioFormat>) -> AudioResult<()> {
        self.output_target =
            target.map(|format| AudioFormat::f32(format.sample_rate, self.format.channels));
        self.swr = None;
        self.converted_frame = frame::Audio::empty();
        Ok(())
    }

    fn playback_sample_rate(&self) -> u32 {
        self.output_target
            .map(|target| target.sample_rate)
            .unwrap_or(self.format.sample_rate)
    }

    fn playback_channels(&self) -> u16 {
        self.format.channels
    }
}

enum DecoderKind {
    Ffmpeg(FfmpegAudioDecoder),
    Dsd(DsdAudioDecoder),
}

pub struct AudioDecoder {
    inner: DecoderKind,
}

impl AudioDecoder {
    pub fn open<P: AsRef<Path>>(path: P) -> AudioResult<Self> {
        let path_ref = path.as_ref();
        if path_ref
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("dff") || e.eq_ignore_ascii_case("dsf"))
        {
            return Ok(Self {
                inner: DecoderKind::Dsd(DsdAudioDecoder::open(path_ref)?),
            });
        }
        Ok(Self {
            inner: DecoderKind::Ffmpeg(FfmpegAudioDecoder::open(path_ref)?),
        })
    }

    pub fn sample_rate(&self) -> u32 {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.sample_rate(),
            DecoderKind::Dsd(decoder) => decoder.format.sample_rate,
        }
    }

    pub fn channels(&self) -> u16 {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.channels(),
            DecoderKind::Dsd(decoder) => decoder.format.channels,
        }
    }

    pub fn path(&self) -> &Path {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.path(),
            DecoderKind::Dsd(decoder) => &decoder.path,
        }
    }

    pub fn quality_badge(&self) -> &QualityBadge {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.quality_badge(),
            DecoderKind::Dsd(decoder) => &decoder.quality_badge,
        }
    }

    pub fn replay_gain_info(&self) -> Option<&ReplayGainInfo> {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.replay_gain_info(),
            DecoderKind::Dsd(_) => None,
        }
    }

    pub fn duration_ms(&self) -> u64 {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.duration_ms(),
            DecoderKind::Dsd(decoder) => decoder.duration_ms,
        }
    }

    pub fn source_format(&self) -> AudioFormat {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.source_format(),
            DecoderKind::Dsd(decoder) => decoder.format,
        }
    }

    pub fn bit_depth(&self) -> u32 {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.bit_depth(),
            DecoderKind::Dsd(_) => 1,
        }
    }

    pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        match &mut self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.seek(target_ms),
            DecoderKind::Dsd(decoder) => decoder.seek(target_ms),
        }
    }

    pub fn decode_next_packet(&mut self) -> AudioResult<Option<&[f32]>> {
        match &mut self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.decode_next_packet(),
            DecoderKind::Dsd(decoder) => decoder.decode_next_packet(),
        }
    }

    pub fn decode_next_bytes(&mut self) -> AudioResult<Option<&[u8]>> {
        match &mut self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.decode_next_bytes(),
            DecoderKind::Dsd(decoder) => decoder.decode_next_bytes(),
        }
    }

    pub fn configure_bit_perfect_wire(
        &mut self,
        target: AudioFormat,
        packed_s24: bool,
        container_bytes: usize,
    ) -> AudioResult<()> {
        if self.quality_badge().source_type.as_deref() == Some("DSD") {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "{} is a DSD source; use Native DSD through ASIO, DoP, or DSD → PCM",
                    self.quality_badge().codec_name
                ),
            });
        }
        match &mut self.inner {
            DecoderKind::Ffmpeg(decoder) => {
                decoder.configure_bit_perfect_wire(target, packed_s24, container_bytes)
            }
            DecoderKind::Dsd(decoder) => Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "{} is a DSD source; use Native DSD through ASIO, DoP, or DSD → PCM",
                    decoder.quality_badge.codec_name
                ),
            }),
        }
    }

    pub fn set_output_format(&mut self, target: Option<AudioFormat>) -> AudioResult<()> {
        match &mut self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.set_output_format(target),
            DecoderKind::Dsd(decoder) => decoder.set_output_format(target),
        }
    }

    /// Playback rate after an explicitly configured software converter. The
    /// source format and quality metadata remain available separately.
    pub fn playback_sample_rate(&self) -> u32 {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.playback_sample_rate(),
            DecoderKind::Dsd(decoder) => decoder.playback_sample_rate(),
        }
    }

    pub fn playback_channels(&self) -> u16 {
        match &self.inner {
            DecoderKind::Ffmpeg(decoder) => decoder.playback_channels(),
            DecoderKind::Dsd(decoder) => decoder.playback_channels(),
        }
    }
}

impl FfmpegAudioDecoder {
    pub fn open<P: AsRef<Path>>(path: P) -> AudioResult<Self> {
        ensure_ffmpeg();
        let path_buf = path.as_ref().to_path_buf();

        let ictx = format::input(&path_buf).map_err(|e| AudioError::UnsupportedFormat {
            path: path_buf.clone(),
            details: e.to_string(),
        })?;

        let stream = ictx.streams().best(media::Type::Audio).ok_or_else(|| {
            AudioError::UnsupportedFormat {
                path: path_buf.clone(),
                details: "No audio stream found".to_string(),
            }
        })?;

        let stream_index = stream.index();
        let time_base = stream.time_base();
        let parameters = stream.parameters();
        let codec_id = parameters.id();

        let codec = decoder::find(codec_id).ok_or_else(|| AudioError::UnsupportedFormat {
            path: path_buf.clone(),
            details: format!("No decoder for codec {:?}", codec_id),
        })?;

        let context =
            codec::context::Context::from_parameters(parameters.clone()).map_err(|e| {
                AudioError::DecodeError {
                    path: path_buf.clone(),
                    details: e.to_string(),
                }
            })?;

        let decoder = context
            .decoder()
            .open_as(codec)
            .map_err(|e| AudioError::DecodeError {
                path: path_buf.clone(),
                details: e.to_string(),
            })?;

        let decoder = decoder.audio().map_err(|e| AudioError::DecodeError {
            path: path_buf.clone(),
            details: e.to_string(),
        })?;

        let (sample_rate, channels, source_av_format, channel_layout, bit_depth, pending_format) =
            probe_source_format(&decoder, &parameters);

        let source_format =
            map_av_to_audio_format(sample_rate, channels, source_av_format, bit_depth);

        let duration_ms = compute_duration_ms(&ictx, stream_index, time_base);
        let replay_gain_info = extract_replay_gain(&ictx, stream_index);
        let quality_badge = build_quality_badge(
            &path_buf,
            codec.name(),
            sample_rate,
            channels,
            bit_depth,
            parameters.bit_rate(),
        );

        Ok(Self {
            path: path_buf,
            ictx,
            decoder,
            stream_index,
            sample_rate,
            channels,
            source_av_format,
            channel_layout,
            source_format,
            bit_depth,
            duration_ms,
            quality_badge,
            replay_gain_info,
            output_target: None,
            swr: None,
            decoded_frame: frame::Audio::empty(),
            converted_frame: frame::Audio::empty(),
            f32_buf: Vec::with_capacity(4096),
            bytes_buf: Vec::with_capacity(8192),
            pack_buf: Vec::with_capacity(8192),
            eof_sent: false,
            finished: false,
            pending_format,
            bit_perfect_wire: None,
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
        self.duration_ms
    }

    pub fn source_format(&self) -> AudioFormat {
        self.source_format
    }

    pub fn bit_depth(&self) -> u32 {
        self.bit_depth
    }

    pub fn seek(&mut self, target_ms: u64) -> AudioResult<u64> {
        let ts = (target_ms as i64).rescale((1, 1000), rescale::TIME_BASE);
        self.ictx
            .seek(ts, ..ts)
            .map_err(|e| AudioError::SeekError {
                target_ms,
                reason: e.to_string(),
            })?;

        self.decoder.flush();
        self.eof_sent = false;
        self.finished = false;
        self.f32_buf.clear();
        self.bytes_buf.clear();

        Ok(target_ms)
    }

    /// Decode next chunk as interleaved f32 in [-1, 1]. Returns `None` at EOF.
    pub fn decode_next_packet(&mut self) -> AudioResult<Option<&[f32]>> {
        match self.pull_frame()? {
            None => Ok(None),
            Some(()) => {
                if let Some(ref mut swr) = self.swr {
                    self.converted_frame = frame::Audio::empty();
                    swr.run(&self.decoded_frame, &mut self.converted_frame)
                        .map_err(|e| AudioError::DecodeError {
                            path: self.path.clone(),
                            details: format!("PCM resampler: {e}"),
                        })?;
                    frame_to_f32(&self.converted_frame, &mut self.f32_buf)?;
                } else {
                    frame_to_f32(&self.decoded_frame, &mut self.f32_buf)?;
                }
                Ok(Some(self.f32_buf.as_slice()))
            }
        }
    }

    fn playback_sample_rate(&self) -> u32 {
        self.output_target
            .map(|target| target.sample_rate)
            .unwrap_or(self.sample_rate)
    }

    fn playback_channels(&self) -> u16 {
        self.output_target
            .map(|target| target.channels)
            .unwrap_or(self.channels)
    }

    /// Decode next chunk as raw interleaved PCM bytes matching `output_format`
    /// (or source format if no converter). Prefer no conversion when formats match.
    pub fn decode_next_bytes(&mut self) -> AudioResult<Option<&[u8]>> {
        match self.pull_frame()? {
            None => Ok(None),
            Some(()) => {
                if let Some(ref mut swr) = self.swr {
                    swr.run(&self.decoded_frame, &mut self.converted_frame)
                        .map_err(|e| AudioError::DecodeError {
                            path: self.path.clone(),
                            details: format!("swr: {e}"),
                        })?;
                    copy_frame_bytes(&self.converted_frame, &mut self.bytes_buf)?;
                } else {
                    copy_frame_bytes(&self.decoded_frame, &mut self.bytes_buf)?;
                    self.apply_bit_perfect_pack()?;
                }
                Ok(Some(self.bytes_buf.as_slice()))
            }
        }
    }

    /// Bit-perfect: native decoder layout must match the exclusive wire format.
    ///
    /// Rate / channel mismatches error out. Container packing only (4-byte
    /// 24-in-32 ↔ packed S24) is converted without resample or DSP.
    pub fn configure_bit_perfect_wire(
        &mut self,
        target: AudioFormat,
        packed_s24: bool,
        container_bytes: usize,
    ) -> AudioResult<()> {
        self.output_target = None;
        self.swr = None;
        self.bit_perfect_wire = Some(BitPerfectWire {
            target,
            packed_s24,
            container_bytes: container_bytes.max(1),
            pack: BitPerfectPack::Identity,
        });
        if self.pending_format || matches!(self.source_av_format, AvSample::None) {
            return Ok(());
        }
        self.resolve_bit_perfect_wire()
    }

    fn resolve_bit_perfect_wire(&mut self) -> AudioResult<()> {
        let Some(wire) = self.bit_perfect_wire.as_ref() else {
            return Ok(());
        };
        let target = wire.target;
        let packed_s24 = wire.packed_s24;
        let container_bytes = wire.container_bytes;

        if self.sample_rate != target.sample_rate || self.channels != target.channels {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "Bit-perfect requires matching rate/channels (source {} Hz / {} ch)",
                    self.sample_rate, self.channels
                ),
            });
        }

        let native_bps = av_container_bytes(self.source_av_format);
        if native_bps == 0 {
            return Ok(());
        }

        if matches!(self.source_av_format, AvSample::U8(_)) {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: "Bit-perfect cannot map unsigned 8-bit PCM onto a 16-bit exclusive wire"
                    .into(),
            });
        }

        let encoding_matches = matches!(
            (self.source_av_format, target.sample_format),
            (AvSample::I16(_), PcmSampleFormat::S16)
                | (AvSample::I32(_), PcmSampleFormat::S24)
                | (AvSample::I32(_), PcmSampleFormat::S32)
                | (AvSample::F32(_), PcmSampleFormat::F32)
        );
        if !encoding_matches {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "Bit-perfect encoding mismatch: decoder {:?} vs wire {:?}",
                    self.source_av_format, target.sample_format
                ),
            });
        }

        let pack = if native_bps == container_bytes {
            BitPerfectPack::Identity
        } else if native_bps == 4 && container_bytes == 3 && packed_s24 {
            BitPerfectPack::Container4ToPacked3
        } else if native_bps == 3 && container_bytes == 4 && !packed_s24 {
            BitPerfectPack::Packed3ToContainer4
        } else {
            return Err(AudioError::FormatNotSupported {
                requested: target.describe(),
                details: format!(
                    "Bit-perfect layout mismatch: decoder {native_bps} bytes/sample vs wire {container_bytes} (packed_s24={packed_s24})"
                ),
            });
        };

        if let Some(wire) = self.bit_perfect_wire.as_mut() {
            wire.pack = pack;
        }
        Ok(())
    }

    fn apply_bit_perfect_pack(&mut self) -> AudioResult<()> {
        let pack = self
            .bit_perfect_wire
            .as_ref()
            .map(|w| w.pack)
            .unwrap_or(BitPerfectPack::Identity);
        match pack {
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

    /// Configure optional software resample/convert toward a target exclusive format.
    /// When `None` or equal to source, disable swr (bit-perfect path).
    pub fn set_output_format(&mut self, target: Option<AudioFormat>) -> AudioResult<()> {
        self.bit_perfect_wire = None;
        self.output_target = target;
        self.rebuild_swr()
    }

    fn rebuild_swr(&mut self) -> AudioResult<()> {
        self.swr = None;

        let Some(target) = self.output_target else {
            return Ok(());
        };

        if formats_match_bitperfect(&self.source_format, &target) {
            return Ok(());
        }

        if self.pending_format || matches!(self.source_av_format, AvSample::None) {
            // Defer until the first decoded frame reveals the native format.
            return Ok(());
        }

        let dst_sample = audio_format_to_av_sample(target.sample_format);
        let dst_layout = ChannelLayout::default(i32::from(target.channels.max(1)));

        let swr = resampling::Context::get(
            self.source_av_format,
            self.channel_layout,
            self.sample_rate.max(1),
            dst_sample,
            dst_layout,
            target.sample_rate.max(1),
        )
        .map_err(|e| AudioError::DecodeError {
            path: self.path.clone(),
            details: format!("Failed to create swr context: {e}"),
        })?;

        self.swr = Some(swr);
        Ok(())
    }

    fn pull_frame(&mut self) -> AudioResult<Option<()>> {
        loop {
            match self.decoder.receive_frame(&mut self.decoded_frame) {
                Ok(()) => {
                    self.apply_frame_format_if_needed()?;
                    return Ok(Some(()));
                }
                Err(FfError::Eof) => {
                    self.finished = true;
                    return Ok(None);
                }
                Err(FfError::Other { errno }) if errno == EAGAIN => {
                    // Need more input packets.
                }
                Err(FfError::InvalidData) => {
                    tracing::warn!("FFmpeg invalid frame data, skipping");
                    continue;
                }
                Err(e) => {
                    return Err(AudioError::DecodeError {
                        path: self.path.clone(),
                        details: e.to_string(),
                    });
                }
            }

            if self.finished {
                return Ok(None);
            }

            let mut packet = Packet::empty();
            match packet.read(&mut self.ictx) {
                Ok(()) => {
                    if packet.stream() != self.stream_index {
                        continue;
                    }
                    match self.decoder.send_packet(&packet) {
                        Ok(()) => continue,
                        Err(FfError::Other { errno }) if errno == EAGAIN => continue,
                        Err(FfError::Eof) => {
                            self.finished = true;
                            return Ok(None);
                        }
                        Err(e) => {
                            tracing::warn!("FFmpeg send_packet error: {e}, skipping");
                            continue;
                        }
                    }
                }
                Err(FfError::Eof) => {
                    if !self.eof_sent {
                        match self.decoder.send_eof() {
                            Ok(()) => {
                                self.eof_sent = true;
                                continue;
                            }
                            Err(FfError::Eof) => {
                                self.finished = true;
                                return Ok(None);
                            }
                            Err(e) => {
                                return Err(AudioError::DecodeError {
                                    path: self.path.clone(),
                                    details: e.to_string(),
                                });
                            }
                        }
                    }
                    self.finished = true;
                    return Ok(None);
                }
                Err(FfError::InvalidData) => continue,
                Err(e) => {
                    return Err(AudioError::DecodeError {
                        path: self.path.clone(),
                        details: e.to_string(),
                    });
                }
            }
        }
    }

    fn apply_frame_format_if_needed(&mut self) -> AudioResult<()> {
        if !self.pending_format && !matches!(self.source_av_format, AvSample::None) {
            return Ok(());
        }

        let rate = self.decoded_frame.rate();
        let ch = self.decoded_frame.channels();
        let fmt = self.decoded_frame.format();
        let mut layout = self.decoded_frame.channel_layout();
        if layout.is_empty() && ch > 0 {
            layout = ChannelLayout::default(i32::from(ch));
        }

        let bits = bits_from_av_sample(fmt, self.bit_depth);
        self.sample_rate = if rate > 0 { rate } else { self.sample_rate };
        self.channels = if ch > 0 { ch } else { self.channels };
        self.source_av_format = fmt;
        self.channel_layout = layout;
        self.bit_depth = bits;
        self.source_format = map_av_to_audio_format(self.sample_rate, self.channels, fmt, bits);
        self.pending_format = false;

        // Refresh badge with resolved format.
        self.quality_badge.sample_rate = self.sample_rate;
        self.quality_badge.channels = self.channels;
        self.quality_badge.bit_depth = Some(self.bit_depth);
        self.quality_badge.is_hi_res =
            QualityBadge::compute_is_hi_res(self.sample_rate, Some(self.bit_depth));

        self.rebuild_swr()?;
        self.resolve_bit_perfect_wire()
    }
}

fn attenuate_dsd_pcm(samples: &mut [f32]) {
    // SACD/DSD can represent levels above 0 dBFS PCM. FFmpeg's dsd2pcm FIR
    // therefore clips unless we take the conventional 6 dB of headroom.
    const DSD_PCM_ATTENUATION: f32 = 0.5;
    for sample in samples {
        *sample *= DSD_PCM_ATTENUATION;
    }
}

fn av_container_bytes(fmt: AvSample) -> usize {
    match fmt {
        AvSample::U8(_) => 1,
        AvSample::I16(_) => 2,
        AvSample::I32(_) | AvSample::F32(_) => 4,
        AvSample::I64(_) | AvSample::F64(_) => 8,
        AvSample::None => 0,
    }
}

fn probe_source_format(
    decoder: &decoder::Audio,
    parameters: &codec::Parameters,
) -> (u32, u16, AvSample, ChannelLayout, u32, bool) {
    let mut sample_rate = decoder.rate();
    let mut channels = decoder.channels();
    let mut source_av_format = decoder.format();
    let mut channel_layout = decoder.channel_layout();
    let bits_raw;

    unsafe {
        let par = parameters.as_ptr();
        if sample_rate == 0 {
            sample_rate = (*par).sample_rate as u32;
        }
        if matches!(source_av_format, AvSample::None) {
            source_av_format = AvSample::from(std::mem::transmute::<
                i32,
                ffmpeg::ffi::AVSampleFormat,
            >((*par).format));
        }
        bits_raw = (*par).bits_per_raw_sample as u32;
        if channel_layout.is_empty() {
            channel_layout = ChannelLayout::from((*par).ch_layout);
        }
        if channels == 0 {
            channels = channel_layout.channels() as u16;
        }
    }

    if channels == 0 {
        channels = 2;
    }
    if sample_rate == 0 {
        sample_rate = 44_100;
    }
    if channel_layout.is_empty() {
        channel_layout = ChannelLayout::default(i32::from(channels));
    }

    let pending = matches!(source_av_format, AvSample::None);
    let bit_depth = bits_from_av_sample(source_av_format, bits_raw);

    (
        sample_rate,
        channels,
        source_av_format,
        channel_layout,
        bit_depth,
        pending,
    )
}

fn bits_from_av_sample(fmt: AvSample, bits_per_raw: u32) -> u32 {
    match fmt {
        AvSample::U8(_) => 8,
        AvSample::I16(_) => 16,
        AvSample::I32(_) => {
            if bits_per_raw == 24 {
                24
            } else if bits_per_raw > 0 {
                bits_per_raw
            } else {
                32
            }
        }
        AvSample::I64(_) => 64,
        AvSample::F32(_) => 32,
        AvSample::F64(_) => 64,
        AvSample::None => {
            if bits_per_raw > 0 {
                bits_per_raw
            } else {
                16
            }
        }
    }
}

fn map_av_to_audio_format(
    sample_rate: u32,
    channels: u16,
    fmt: AvSample,
    bit_depth: u32,
) -> AudioFormat {
    let (sample_format, depth) = match fmt {
        AvSample::I16(_) => (PcmSampleFormat::S16, 16),
        AvSample::I32(_) if bit_depth == 24 => (PcmSampleFormat::S24, 24),
        AvSample::I32(_) => (PcmSampleFormat::S32, 32),
        AvSample::F32(_) => (PcmSampleFormat::F32, 32),
        AvSample::F64(_) => (PcmSampleFormat::F32, 32),
        AvSample::U8(_) => (PcmSampleFormat::S16, 16),
        AvSample::I64(_) => (PcmSampleFormat::S32, 32),
        AvSample::None => {
            if bit_depth == 24 {
                (PcmSampleFormat::S24, 24)
            } else if bit_depth >= 32 {
                (PcmSampleFormat::S32, 32)
            } else {
                (PcmSampleFormat::S16, 16)
            }
        }
    };
    AudioFormat::new(sample_rate, channels, sample_format, depth)
}

fn audio_format_to_av_sample(fmt: PcmSampleFormat) -> AvSample {
    match fmt {
        PcmSampleFormat::S16 => AvSample::I16(SampleType::Packed),
        // FFmpeg has no packed S24; 24-bit travels as S32 (24-in-32).
        PcmSampleFormat::S24 | PcmSampleFormat::S32 => AvSample::I32(SampleType::Packed),
        PcmSampleFormat::F32 => AvSample::F32(SampleType::Packed),
    }
}

fn formats_match_bitperfect(source: &AudioFormat, target: &AudioFormat) -> bool {
    source.sample_rate == target.sample_rate
        && source.channels == target.channels
        && source.sample_format == target.sample_format
        && source.bit_depth == target.bit_depth
}

fn compute_duration_ms(
    ictx: &format::context::Input,
    stream_index: usize,
    time_base: Rational,
) -> u64 {
    if let Some(stream) = ictx.streams().nth(stream_index) {
        let dur = stream.duration();
        if dur > 0 {
            let ms = dur.rescale(time_base, (1, 1000));
            if ms > 0 {
                return ms as u64;
            }
        }
    }

    let format_dur = ictx.duration();
    if format_dur > 0 {
        // AV_TIME_BASE is microseconds.
        return (format_dur as u64) / 1000;
    }
    0
}

fn extract_replay_gain(
    ictx: &format::context::Input,
    stream_index: usize,
) -> Option<ReplayGainInfo> {
    let mut info = ReplayGainInfo::default();
    let mut found = false;

    let mut apply = |key: &str, val: &str| {
        let key_u = key.to_ascii_uppercase();
        if key_u.contains("REPLAYGAIN_TRACK_GAIN") || key_u.contains("R128_TRACK_GAIN") {
            if let Some(db) = parse_db_string(val) {
                info.track_gain_db = Some(db);
                found = true;
            }
        } else if key_u.contains("REPLAYGAIN_TRACK_PEAK") {
            if let Ok(peak) = val.trim().parse::<f32>() {
                info.track_peak = Some(peak);
                found = true;
            }
        } else if key_u.contains("REPLAYGAIN_ALBUM_GAIN") || key_u.contains("R128_ALBUM_GAIN") {
            if let Some(db) = parse_db_string(val) {
                info.album_gain_db = Some(db);
                found = true;
            }
        } else if key_u.contains("REPLAYGAIN_ALBUM_PEAK") {
            if let Ok(peak) = val.trim().parse::<f32>() {
                info.album_peak = Some(peak);
                found = true;
            }
        }
    };

    for (k, v) in ictx.metadata().iter() {
        apply(k, v);
    }

    if let Some(stream) = ictx.streams().nth(stream_index) {
        for (k, v) in stream.metadata().iter() {
            apply(k, v);
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
    codec_name: &str,
    sample_rate: u32,
    channels: u16,
    bit_depth: u32,
    bit_rate: i64,
) -> QualityBadge {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_lowercase();

    let codec_name_upper = codec_name.to_uppercase();
    let is_lossless = match ext.as_str() {
        "flac" | "wav" | "alac" | "aiff" | "aif" | "pcm" => true,
        "mp3" | "ogg" | "aac" | "m4a" | "opus" | "wma" => false,
        _ => {
            codec_name_upper.contains("FLAC")
                || codec_name_upper.contains("PCM")
                || codec_name_upper.contains("ALAC")
                || codec_name_upper.contains("WAVPACK")
        }
    };

    let bit_depth_opt = if bit_depth > 0 { Some(bit_depth) } else { None };
    let is_hi_res = QualityBadge::compute_is_hi_res(sample_rate, bit_depth_opt);
    let bitrate_kbps = if bit_rate > 0 {
        Some((bit_rate / 1000) as u32)
    } else {
        None
    };

    QualityBadge {
        sample_rate,
        channels,
        bit_depth: bit_depth_opt,
        bitrate_kbps,
        codec_name: codec_name_upper,
        container_format: ext.clone(),
        is_lossless,
        is_hi_res,
        source_type: if matches!(ext.as_str(), "dsf" | "dff") {
            Some("DSD".into())
        } else {
            None
        },
        dsd_rate: if matches!(ext.as_str(), "dsf" | "dff") {
            crate::audio::dsd::dsd_rate_from_sample_rate(sample_rate.saturating_mul(8)).ok()
        } else {
            None
        },
        dsd_output_mode: if matches!(ext.as_str(), "dsf" | "dff") {
            Some(DsdOutputMode::Pcm)
        } else {
            None
        },
    }
}

fn frame_to_f32(frame: &frame::Audio, out: &mut Vec<f32>) -> AudioResult<()> {
    out.clear();
    let ch = frame.channels().max(1) as usize;
    let n = frame.samples();
    if n == 0 {
        return Ok(());
    }

    match frame.format() {
        AvSample::F32(SampleType::Packed) => {
            let plane = frame.plane::<f32>(0);
            out.extend_from_slice(&plane[..n * ch]);
        }
        AvSample::F32(SampleType::Planar) => {
            out.reserve(n * ch);
            let planes: Vec<&[f32]> = (0..ch).map(|c| frame.plane::<f32>(c)).collect();
            for i in 0..n {
                for plane in &planes {
                    out.push(plane[i]);
                }
            }
        }
        AvSample::I16(SampleType::Packed) => {
            let plane = frame.plane::<i16>(0);
            out.reserve(n * ch);
            for &s in &plane[..n * ch] {
                out.push(s as f32 / 32768.0);
            }
        }
        AvSample::I16(SampleType::Planar) => {
            out.reserve(n * ch);
            let planes: Vec<&[i16]> = (0..ch).map(|c| frame.plane::<i16>(c)).collect();
            for i in 0..n {
                for plane in &planes {
                    out.push(plane[i] as f32 / 32768.0);
                }
            }
        }
        AvSample::I32(SampleType::Packed) => {
            let plane = frame.plane::<i32>(0);
            out.reserve(n * ch);
            for &s in &plane[..n * ch] {
                out.push(s as f32 / 2_147_483_648.0);
            }
        }
        AvSample::I32(SampleType::Planar) => {
            out.reserve(n * ch);
            let planes: Vec<&[i32]> = (0..ch).map(|c| frame.plane::<i32>(c)).collect();
            for i in 0..n {
                for plane in &planes {
                    out.push(plane[i] as f32 / 2_147_483_648.0);
                }
            }
        }
        AvSample::F64(SampleType::Packed) => {
            let plane = frame.plane::<f64>(0);
            out.reserve(n * ch);
            for &s in &plane[..n * ch] {
                out.push(s as f32);
            }
        }
        AvSample::F64(SampleType::Planar) => {
            out.reserve(n * ch);
            let planes: Vec<&[f64]> = (0..ch).map(|c| frame.plane::<f64>(c)).collect();
            for i in 0..n {
                for plane in &planes {
                    out.push(plane[i] as f32);
                }
            }
        }
        AvSample::U8(SampleType::Packed) => {
            let plane = frame.plane::<u8>(0);
            out.reserve(n * ch);
            for &s in &plane[..n * ch] {
                out.push((s as f32 - 128.0) / 128.0);
            }
        }
        AvSample::U8(SampleType::Planar) => {
            out.reserve(n * ch);
            let planes: Vec<&[u8]> = (0..ch).map(|c| frame.plane::<u8>(c)).collect();
            for i in 0..n {
                for plane in &planes {
                    out.push((plane[i] as f32 - 128.0) / 128.0);
                }
            }
        }
        other => {
            return Err(AudioError::DecodeError {
                path: PathBuf::new(),
                details: format!("Unsupported sample format for f32 convert: {:?}", other),
            });
        }
    }
    Ok(())
}

fn copy_frame_bytes(frame: &frame::Audio, out: &mut Vec<u8>) -> AudioResult<()> {
    out.clear();
    let ch = frame.channels().max(1) as usize;
    let n = frame.samples();
    if n == 0 {
        return Ok(());
    }

    let bytes_per = frame.format().bytes();
    if bytes_per == 0 {
        return Err(AudioError::DecodeError {
            path: PathBuf::new(),
            details: "Unknown bytes-per-sample".to_string(),
        });
    }

    if frame.is_packed() {
        let need = n * ch * bytes_per;
        let data = frame.data(0);
        if data.len() < need {
            return Err(AudioError::DecodeError {
                path: PathBuf::new(),
                details: format!("Packed frame short: have {} need {}", data.len(), need),
            });
        }
        out.extend_from_slice(&data[..need]);
        return Ok(());
    }

    // Planar → interleaved packed.
    out.reserve(n * ch * bytes_per);
    for i in 0..n {
        for c in 0..ch {
            let plane = frame.data(c);
            let start = i * bytes_per;
            let end = start + bytes_per;
            if end > plane.len() {
                return Err(AudioError::DecodeError {
                    path: PathBuf::new(),
                    details: "Planar frame short while interleaving".to_string(),
                });
            }
            out.extend_from_slice(&plane[start..end]);
        }
    }
    Ok(())
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

    #[test]
    fn test_map_s32_24bit() {
        let fmt = map_av_to_audio_format(96_000, 2, AvSample::I32(SampleType::Packed), 24);
        assert_eq!(fmt.sample_format, PcmSampleFormat::S24);
        assert_eq!(fmt.bit_depth, 24);
    }

    #[test]
    fn dff_raw_feeds_ffmpeg_dsd_decoder() {
        fn chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(id);
            out.extend_from_slice(&(payload.len() as u64).to_be_bytes());
            out.extend_from_slice(payload);
            if payload.len() % 2 != 0 {
                out.push(0);
            }
            out
        }
        let mut prop = b"SND ".to_vec();
        prop.extend(chunk(b"FS  ", &2_822_400u32.to_be_bytes()));
        prop.extend(chunk(b"CHNL", &[0, 2, b'S', b'L', b'F', b'L', b'S', b'R']));
        prop.extend(chunk(b"CMPR", b"DSD "));
        let mut inner = chunk(b"FVER", &0x0105_0000u32.to_be_bytes());
        inner.extend(chunk(b"PROP", &prop));
        inner.extend(chunk(b"DSD ", &[0x69; 4096]));
        let mut bytes = b"FRM8".to_vec();
        bytes.extend_from_slice(&((4 + inner.len()) as u64).to_be_bytes());
        bytes.extend_from_slice(b"DSD ");
        bytes.extend(inner);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.dff");
        std::fs::write(&path, bytes).unwrap();
        let mut decoder = AudioDecoder::open(&path).unwrap();
        assert_eq!(
            decoder.quality_badge().dsd_rate,
            Some(crate::audio::dto::DsdRate::Dsd64)
        );
        let samples = decoder.decode_next_packet().unwrap().unwrap();
        assert!(!samples.is_empty());
        assert!(samples.iter().all(|sample| sample.is_finite()));
        assert!(
            samples
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0, f32::max)
                < 0.01
        );
        let mut resampler = crate::audio::gapless::LinearResampler::new(352_800, 48_000, 2);
        let mut resampled = Vec::new();
        resampler.resample(samples, &mut resampled);
        assert!(
            resampled
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0, f32::max)
                < 0.01
        );

        let mut converted = AudioDecoder::open(&path).unwrap();
        converted
            .set_output_format(Some(AudioFormat::f32(44_100, 2)))
            .unwrap();
        let converted_samples = converted.decode_next_packet().unwrap().unwrap();
        assert!(converted_samples.len() < samples.len());
        assert!(
            converted_samples
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0, f32::max)
                < 0.01
        );
    }

    #[test]
    fn dff_source_rejects_bit_perfect_wire() {
        fn chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(id);
            out.extend_from_slice(&(payload.len() as u64).to_be_bytes());
            out.extend_from_slice(payload);
            if payload.len() % 2 != 0 {
                out.push(0);
            }
            out
        }
        let mut prop = b"SND ".to_vec();
        prop.extend(chunk(b"FS  ", &2_822_400u32.to_be_bytes()));
        prop.extend(chunk(b"CHNL", &[0, 2, b'S', b'L', b'F', b'L', b'S', b'R']));
        prop.extend(chunk(b"CMPR", b"DSD "));
        let mut inner = chunk(b"FVER", &0x0105_0000u32.to_be_bytes());
        inner.extend(chunk(b"PROP", &prop));
        inner.extend(chunk(b"DSD ", &[0x69; 4096]));
        let mut bytes = b"FRM8".to_vec();
        bytes.extend_from_slice(&((4 + inner.len()) as u64).to_be_bytes());
        bytes.extend_from_slice(b"DSD ");
        bytes.extend(inner);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bit-perfect-reject.dff");
        std::fs::write(&path, bytes).unwrap();
        let mut decoder = AudioDecoder::open(&path).unwrap();
        assert_eq!(decoder.quality_badge().source_type.as_deref(), Some("DSD"));
        let err = decoder
            .configure_bit_perfect_wire(AudioFormat::s24_in_32(176_400, 2), false, 4)
            .expect_err("DSD must not enter the bit-perfect PCM wire");
        let message = err.to_string();
        assert!(
            message.to_ascii_lowercase().contains("dsd"),
            "unexpected error: {message}"
        );
    }

    #[test]
    fn dff_dst_feeds_ffmpeg_dst_decoder() {
        fn chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
            let mut out = Vec::with_capacity(12 + payload.len() + payload.len() % 2);
            out.extend_from_slice(id);
            out.extend_from_slice(&(payload.len() as u64).to_be_bytes());
            out.extend_from_slice(payload);
            if payload.len() % 2 != 0 {
                out.push(0);
            }
            out
        }

        let mut prop = b"SND ".to_vec();
        prop.extend(chunk(b"FS  ", &2_822_400u32.to_be_bytes()));
        prop.extend(chunk(b"CHNL", &[0, 2, b'S', b'L', b'F', b'L', b'S', b'R']));
        prop.extend(chunk(b"CMPR", b"DST "));

        // FFmpeg accepts a DST frame whose first byte marks the uncompressed
        // form, followed by one DSD64 frame (4,704 samples × 2 channels).
        let mut dst_frame = vec![0u8];
        dst_frame.extend(std::iter::repeat_n(0x69, 4_704 * 2));
        let mut dst_payload = chunk(b"FRTE", &[0, 0, 0, 1, 0, 75, 0, 0]);
        dst_payload.extend(chunk(b"DSTF", &dst_frame));

        let mut inner = chunk(b"FVER", &0x0105_0000u32.to_be_bytes());
        inner.extend(chunk(b"PROP", &prop));
        inner.extend(chunk(b"DST ", &dst_payload));
        let mut bytes = b"FRM8".to_vec();
        bytes.extend_from_slice(&((4 + inner.len()) as u64).to_be_bytes());
        bytes.extend_from_slice(b"DSD ");
        bytes.extend(inner);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture-dst.dff");
        std::fs::write(&path, bytes).unwrap();
        let mut decoder = AudioDecoder::open(&path).unwrap();
        assert_eq!(decoder.quality_badge().codec_name, "DST");
        let samples = decoder.decode_next_packet().unwrap().unwrap();
        assert!(!samples.is_empty());
        assert!(samples.iter().all(|sample| sample.is_finite()));

        let mut converted = AudioDecoder::open(&path).unwrap();
        converted
            .set_output_format(Some(AudioFormat::f32(44_100, 2)))
            .unwrap();
        let converted_samples = converted.decode_next_packet().unwrap().unwrap();
        assert!(!converted_samples.is_empty());
        assert!(converted_samples.len() < 4_704 * 2);
        assert!(converted_samples.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn dsf_pcm_uses_band_limited_ffmpeg_resampler() {
        let sample_count = 32_768u64;
        let data_size = sample_count / 8 * 2;
        let file_size = 28 + 12 + 40 + 12 + data_size;
        let mut bytes = Vec::with_capacity(file_size as usize);
        bytes.extend_from_slice(b"DSD ");
        bytes.extend_from_slice(&28u64.to_le_bytes());
        bytes.extend_from_slice(&file_size.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&52u64.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2_822_400u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&sample_count.to_le_bytes());
        bytes.extend_from_slice(&4096u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(12u64 + data_size).to_le_bytes());
        // DSF LSB-first 0x96 is digital silence for DSD_LSBF_PLANAR.
        bytes.extend(std::iter::repeat_n(0x96, data_size as usize));

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.dsf");
        std::fs::write(&path, bytes).unwrap();
        let mut decoder = AudioDecoder::open(&path).unwrap();
        assert_eq!(decoder.quality_badge().codec_name, "DSD");
        decoder
            .set_output_format(Some(AudioFormat::f32(44_100, 2)))
            .unwrap();
        let samples = decoder.decode_next_packet().unwrap().unwrap();
        assert!(!samples.is_empty());
        assert!(samples.len() < 8_192);
        assert!(samples.iter().all(|sample| sample.is_finite()));
        assert!(
            samples
                .iter()
                .map(|sample| sample.abs())
                .fold(0.0, f32::max)
                < 0.01
        );
    }

    #[test]
    fn dsf_ffmpeg_source_rejects_bit_perfect_wire() {
        let sample_count = 32_768u64;
        let data_size = sample_count / 8 * 2;
        let file_size = 28 + 12 + 40 + 12 + data_size;
        let mut bytes = Vec::with_capacity(file_size as usize);
        bytes.extend_from_slice(b"DSD ");
        bytes.extend_from_slice(&28u64.to_le_bytes());
        bytes.extend_from_slice(&file_size.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&52u64.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2_822_400u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&sample_count.to_le_bytes());
        bytes.extend_from_slice(&4096u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(12u64 + data_size).to_le_bytes());
        bytes.extend(std::iter::repeat_n(0x96, data_size as usize));

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bit-perfect-reject.dsf");
        std::fs::write(&path, bytes).unwrap();
        let mut decoder = AudioDecoder::open(&path).unwrap();
        assert_eq!(decoder.quality_badge().source_type.as_deref(), Some("DSD"));
        let err = decoder
            .configure_bit_perfect_wire(AudioFormat::s24_in_32(176_400, 2), false, 4)
            .expect_err("DSF must not enter the bit-perfect PCM wire");
        assert!(err.to_string().to_ascii_lowercase().contains("dsd"));
    }
}

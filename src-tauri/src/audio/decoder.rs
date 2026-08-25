//! FFmpeg-based streaming audio decoder (`ffmpeg-next` 9.x).
//!
//! Provides interleaved f32 samples for the DSP / gapless path and optional
//! raw PCM bytes for bit-perfect WASAPI Exclusive output.

use std::path::{Path, PathBuf};
use std::sync::Once;

use ffmpeg::channel_layout::ChannelLayout;
use ffmpeg::codec::{self, decoder, packet::Packet};
use ffmpeg::format::sample::{Sample as AvSample, Type as SampleType};
use ffmpeg::software::resampling;
use ffmpeg::util::error::{Error as FfError, EAGAIN};
use ffmpeg::{format, frame, media, rescale, Rational, Rescale};
use ffmpeg_next as ffmpeg;

use crate::audio::dto::{QualityBadge, ReplayGainInfo};
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

pub struct AudioDecoder {
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

impl AudioDecoder {
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
                frame_to_f32(&self.decoded_frame, &mut self.f32_buf)?;
                Ok(Some(self.f32_buf.as_slice()))
            }
        }
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
        container_format: ext,
        is_lossless,
        is_hi_res,
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
}

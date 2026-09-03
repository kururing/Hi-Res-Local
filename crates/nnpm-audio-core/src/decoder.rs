//! Symphonia PCM decoder with seek/flush and optional bit-perfect bytes.

use std::io::Cursor;

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource as SymphoniaSource, MediaSourceStream};
use symphonia::core::meta::{Limit, MetadataOptions};
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

use crate::error::{CoreError, CoreResult};
use crate::source::MediaSource;
use crate::types::{AudioInfo, DecodedSampleRepr};

pub struct PcmDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    info: AudioInfo,
    f32_buf: Vec<f32>,
    bytes_buf: Vec<u8>,
    source_bits: u16,
    last_repr: DecodedSampleRepr,
    finished: bool,
}

impl PcmDecoder {
    pub fn open(source: MediaSource) -> CoreResult<Self> {
        let label = source.label();
        let mut hint = Hint::new();
        if let Some(path) = source.path() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                hint.with_extension(ext);
            }
        }
        let boxed: Box<dyn SymphoniaSource> = match source {
            MediaSource::File { file, .. } => Box::new(file),
            MediaSource::Memory { cursor, .. } => Box::new(Cursor::new(cursor.into_inner())),
            #[cfg(not(target_arch = "wasm32"))]
            MediaSource::Http(reader) => Box::new(reader),
        };
        Self::open_boxed(boxed, label, hint)
    }

    /// Open a `Read + Seek` source without requiring a contiguous `&[u8]` of the file.
    pub fn open_boxed(
        source: Box<dyn SymphoniaSource>,
        label: impl Into<String>,
        hint: Hint,
    ) -> CoreResult<Self> {
        let label = label.into();
        let mss = MediaSourceStream::new(source, Default::default());
        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions {
                    // Do not keep album art in the demuxer. The FLAC reader still walks
                    // the picture block; Range I/O must not pin those bytes in WASM.
                    limit_visual_bytes: Limit::Maximum(0),
                    ..MetadataOptions::default()
                },
            )
            .map_err(|e| CoreError::Unsupported(format!("{label}: {e}")))?;
        let format = probed.format;
        let track = format
            .default_track()
            .ok_or_else(|| CoreError::Unsupported(format!("{label}: no audio track")))?
            .clone();
        let codecs = moosicbox_opus::create_opus_registry();
        let decoder = codecs
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| CoreError::Unsupported(format!("{label}: {e}")))?;
        let sample_rate = track
            .codec_params
            .sample_rate
            .ok_or_else(|| CoreError::Unsupported(format!("{label}: missing sample rate")))?;
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count() as u16)
            .unwrap_or(2);
        let duration_ms = track
            .codec_params
            .n_frames
            .map(|n| n.saturating_mul(1000) / u64::from(sample_rate.max(1)))
            .unwrap_or(0);
        let bit_depth = track.codec_params.bits_per_sample.map(|b| b as u16);
        let channel_layout = track
            .codec_params
            .channels
            .map(|layout| format!("{layout:?}"));
        let codec = format!("{:?}", track.codec_params.codec).to_ascii_lowercase();
        let codec_name = if codec.contains("flac") {
            "flac"
        } else if codec.contains("mp3") || codec.contains("mpeg") {
            "mp3"
        } else if codec.contains("aac") {
            "aac"
        } else if codec.contains("alac") {
            "alac"
        } else if codec.contains("vorbis") {
            "vorbis"
        } else if codec.contains("opus") {
            "opus"
        } else {
            "pcm"
        };
        let lossless = matches!(codec_name, "flac" | "alac" | "pcm");
        Ok(Self {
            format,
            decoder,
            track_id: track.id,
            info: AudioInfo {
                container: String::new(),
                codec: codec_name.into(),
                duration_ms,
                sample_rate,
                bit_depth,
                channels,
                channel_layout,
                bitrate_kbps: None,
                lossless,
                hi_res: lossless && (sample_rate > 48_000 || bit_depth.unwrap_or(0) > 16),
                dsd_rate: None,
                lsb_first: false,
            },
            f32_buf: Vec::with_capacity(8192),
            bytes_buf: Vec::with_capacity(16_384),
            source_bits: bit_depth.unwrap_or(16),
            last_repr: DecodedSampleRepr::Unknown,
            finished: false,
        })
    }

    pub fn info(&self) -> &AudioInfo {
        &self.info
    }

    pub fn sample_rate(&self) -> u32 {
        self.info.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.info.channels
    }

    pub fn duration_ms(&self) -> u64 {
        self.info.duration_ms
    }

    pub fn decode_next(&mut self) -> CoreResult<Option<&[f32]>> {
        if self.finished {
            return Ok(None);
        }
        loop {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    self.finished = true;
                    return Ok(None);
                }
                Err(SymError::ResetRequired) => {
                    self.decoder.reset();
                    continue;
                }
                Err(e) => return Err(CoreError::Decode(e.to_string())),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(buffer) => {
                    copy_buffer_f32(&buffer, &mut self.f32_buf);
                    self.last_repr =
                        copy_buffer_bytes(&buffer, self.source_bits, &mut self.bytes_buf);
                    if self.f32_buf.is_empty() {
                        continue;
                    }
                    return Ok(Some(&self.f32_buf));
                }
                Err(SymError::DecodeError(_)) => continue,
                Err(e) => return Err(CoreError::Decode(e.to_string())),
            }
        }
    }

    pub fn decode_all_f32(&mut self) -> CoreResult<Vec<f32>> {
        let mut out = Vec::new();
        while let Some(chunk) = self.decode_next()? {
            out.extend_from_slice(chunk);
        }
        Ok(out)
    }

    pub fn seek(&mut self, target_ms: u64) -> CoreResult<u64> {
        let seconds = (target_ms / 1000) as u64;
        let frac = (target_ms % 1000) as f64 / 1000.0;
        self.format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: Time { seconds, frac },
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|e| CoreError::Seek(e.to_string()))?;
        self.decoder.reset();
        self.finished = false;
        Ok(target_ms)
    }

    pub fn flush(&mut self) {
        self.decoder.reset();
        self.f32_buf.clear();
        self.bytes_buf.clear();
        self.last_repr = DecodedSampleRepr::Unknown;
    }

    pub fn last_bytes(&self) -> &[u8] {
        &self.bytes_buf
    }

    pub fn last_repr(&self) -> DecodedSampleRepr {
        self.last_repr
    }

    pub fn source_bits(&self) -> u16 {
        self.source_bits
    }
}

/// Pack left-justified S32 samples to the file's logical PCM width.
///
/// Symphonia FLAC/ALAC emit S32 with valid bits in the most-significant bits.
/// A 16-bit file must become 2-byte PCM16 (`v >> 16`), not a 4-byte dump —
/// otherwise WASAPI PCM16 stereo reads each i32 as one L/R frame.
pub fn pack_s32_left_justified(samples: &[i32], source_bits: u16, out: &mut Vec<u8>) {
    out.clear();
    if source_bits <= 16 {
        out.reserve(samples.len() * 2);
        for &sample in samples {
            let v = (sample >> 16) as i16;
            out.extend_from_slice(&v.to_le_bytes());
        }
        return;
    }
    out.reserve(samples.len() * 4);
    for &sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
}

fn copy_buffer_f32(buffer: &AudioBufferRef<'_>, out: &mut Vec<f32>) {
    out.clear();
    match buffer {
        AudioBufferRef::F32(buf) => planar_to_interleaved(buf, out, |s| *s),
        AudioBufferRef::F64(buf) => planar_to_interleaved(buf, out, |s| *s as f32),
        AudioBufferRef::S32(buf) => planar_to_interleaved(buf, out, |s| *s as f32 / 2147483648.0),
        AudioBufferRef::S16(buf) => planar_to_interleaved(buf, out, |s| *s as f32 / 32768.0),
        AudioBufferRef::U8(buf) => planar_to_interleaved(buf, out, |s| (*s as f32 - 128.0) / 128.0),
        AudioBufferRef::U16(buf) => {
            planar_to_interleaved(buf, out, |s| (*s as f32 - 32768.0) / 32768.0)
        }
        AudioBufferRef::U24(buf) => planar_to_interleaved(buf, out, |s| normalize_u24(s.inner())),
        AudioBufferRef::S24(buf) => {
            planar_to_interleaved(buf, out, |s| s.inner() as f32 / 8_388_608.0)
        }
        AudioBufferRef::U32(buf) => planar_to_interleaved(buf, out, |s| {
            (*s as f32 - 2_147_483_648.0) / 2_147_483_648.0
        }),
        AudioBufferRef::S8(buf) => planar_to_interleaved(buf, out, |s| *s as f32 / 128.0),
    }
}

#[inline]
fn normalize_u24(sample: u32) -> f32 {
    (sample as f32 - 8_388_608.0) / 8_388_608.0
}

fn copy_buffer_bytes(
    buffer: &AudioBufferRef<'_>,
    source_bits: u16,
    out: &mut Vec<u8>,
) -> DecodedSampleRepr {
    out.clear();
    match buffer {
        AudioBufferRef::S16(buf) => {
            interleave_i16(buf, out);
            DecodedSampleRepr::S16
        }
        AudioBufferRef::S32(buf) => {
            let ch = buf.spec().channels.count();
            let frames = buf.frames();
            let mut samples = Vec::with_capacity(frames * ch);
            for f in 0..frames {
                for c in 0..ch {
                    samples.push(buf.chan(c)[f]);
                }
            }
            pack_s32_left_justified(&samples, source_bits, out);
            DecodedSampleRepr::S32
        }
        AudioBufferRef::S24(buf) => {
            // i24.inner() is right-justified; WASAPI 24-in-32 wants the high 24 bits.
            let ch = buf.spec().channels.count();
            let frames = buf.frames();
            out.reserve(frames * ch * 4);
            for f in 0..frames {
                for c in 0..ch {
                    let container = buf.chan(c)[f].inner() << 8;
                    out.extend_from_slice(&container.to_le_bytes());
                }
            }
            DecodedSampleRepr::S24
        }
        AudioBufferRef::F32(buf) => {
            let ch = buf.spec().channels.count();
            let frames = buf.frames();
            out.reserve(frames * ch * 4);
            for f in 0..frames {
                for c in 0..ch {
                    out.extend_from_slice(&buf.chan(c)[f].to_le_bytes());
                }
            }
            DecodedSampleRepr::F32
        }
        AudioBufferRef::F64(_) => DecodedSampleRepr::F64,
        AudioBufferRef::S8(_) => DecodedSampleRepr::S8,
        AudioBufferRef::U8(_) => DecodedSampleRepr::U8,
        AudioBufferRef::U16(_) => DecodedSampleRepr::U16,
        AudioBufferRef::U24(_) => DecodedSampleRepr::U24,
        AudioBufferRef::U32(_) => DecodedSampleRepr::U32,
    }
}

fn interleave_i16(buf: &symphonia::core::audio::AudioBuffer<i16>, out: &mut Vec<u8>) {
    let ch = buf.spec().channels.count();
    let frames = buf.frames();
    out.reserve(frames * ch * 2);
    for f in 0..frames {
        for c in 0..ch {
            out.extend_from_slice(&buf.chan(c)[f].to_le_bytes());
        }
    }
}

fn planar_to_interleaved<S: symphonia::core::sample::Sample>(
    buf: &symphonia::core::audio::AudioBuffer<S>,
    out: &mut Vec<f32>,
    mut conv: impl FnMut(&S) -> f32,
) {
    let ch = buf.spec().channels.count();
    let frames = buf.frames();
    out.reserve(frames * ch);
    for f in 0..frames {
        for c in 0..ch {
            out.push(conv(&buf.chan(c)[f]));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm16_stereo_frame_offsets() {
        // L0=0x1234, R0=0x5678, L1=-1, R1=0x0001
        let samples = [
            0x1234i32 << 16,
            0x5678i32 << 16,
            (-1i32) << 16,
            0x0001i32 << 16,
        ];
        let mut bytes = Vec::new();
        pack_s32_left_justified(&samples, 16, &mut bytes);
        assert_eq!(bytes, [0x34, 0x12, 0x78, 0x56, 0xFF, 0xFF, 0x01, 0x00]);
        assert_eq!(bytes.len() % 4, 0);
        let frame0 = 0;
        let frame1 = 4;
        assert_eq!(&bytes[frame0..frame0 + 2], &[0x34, 0x12]); // Left
        assert_eq!(&bytes[frame0 + 2..frame0 + 4], &[0x78, 0x56]); // Right
        assert_eq!(&bytes[frame1..frame1 + 2], &[0xFF, 0xFF]);
        assert_eq!(&bytes[frame1 + 2..frame1 + 4], &[0x01, 0x00]);
    }

    #[test]
    fn s32_16bit_is_not_dumped_as_four_byte_frames() {
        // Bug regression: dumping S32 LE into PCM16 makes L=0x0000, R=sample.
        let left = 0x1234i32 << 16;
        let right = 0i32;
        let mut dumped = Vec::new();
        dumped.extend_from_slice(&left.to_le_bytes());
        dumped.extend_from_slice(&right.to_le_bytes());
        assert_eq!(dumped, [0x00, 0x00, 0x34, 0x12, 0x00, 0x00, 0x00, 0x00]);

        let mut packed = Vec::new();
        pack_s32_left_justified(&[left, right], 16, &mut packed);
        assert_eq!(packed, [0x34, 0x12, 0x00, 0x00]);
        assert_ne!(packed, dumped, "must not pass S32 container bytes as PCM16");
    }

    #[test]
    fn s32_24bit_keeps_24_in_32_container() {
        let sample = 0x123456i32 << 8;
        let mut bytes = Vec::new();
        pack_s32_left_justified(&[sample], 24, &mut bytes);
        assert_eq!(bytes, sample.to_le_bytes());
        assert_eq!(bytes.len(), 4);
        assert_eq!(bytes[0], 0x00, "low 8 bits are padding");
    }

    #[test]
    fn unsigned_24_pcm_is_centered_around_zero() {
        assert_eq!(normalize_u24(0), -1.0);
        assert_eq!(normalize_u24(8_388_608), 0.0);
        assert!(normalize_u24(16_777_215) < 1.0);
    }

    #[test]
    fn open_boxed_decodes_wav_without_a_contiguous_file_slice() {
        use std::io::{Read, Seek, SeekFrom};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        use crate::wav::{sine_s16, write_wav_s16};

        struct WindowedSource {
            inner: Cursor<Vec<u8>>,
            max_read: usize,
            largest: Arc<AtomicUsize>,
        }

        impl Read for WindowedSource {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                let n = buf.len().min(self.max_read);
                let got = self.inner.read(&mut buf[..n])?;
                self.largest.fetch_max(got, Ordering::Relaxed);
                Ok(got)
            }
        }

        impl Seek for WindowedSource {
            fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
                self.inner.seek(pos)
            }
        }

        impl symphonia::core::io::MediaSource for WindowedSource {
            fn is_seekable(&self) -> bool {
                true
            }

            fn byte_len(&self) -> Option<u64> {
                Some(self.inner.get_ref().len() as u64)
            }
        }

        let samples = sine_s16(8_000, 2, 440.0, 48_000);
        let bytes = write_wav_s16(48_000, 2, &samples);
        assert!(bytes.len() > 8_192);
        let largest = Arc::new(AtomicUsize::new(0));
        let source = WindowedSource {
            inner: Cursor::new(bytes),
            max_read: 4_096,
            largest: Arc::clone(&largest),
        };
        let mut hint = Hint::new();
        hint.with_extension("wav");
        let mut decoder = PcmDecoder::open_boxed(Box::new(source), "range.wav", hint).unwrap();
        let pcm = decoder.decode_all_f32().unwrap();
        assert!(pcm.len() >= 8_000 * 2);
        assert!(largest.load(Ordering::Relaxed) <= 4_096);
        assert!(largest.load(Ordering::Relaxed) > 0);
    }
}

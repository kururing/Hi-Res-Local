//! Parsers and stream readers for Sony DSF and DSDIFF (DFF) files.
//!
//! The application deliberately keeps this parser independent from Lofty. Lofty
//! is useful for the formats it supports, but DSF/DFF are container formats with
//! technical metadata that must be read even when the file has no tags.

#![allow(clippy::manual_is_multiple_of)] // Keep compatibility with the project's Rust 1.80 MSRV.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::audio::dto::{DsdOutputMode, DsdRate, QualityBadge};

const MAX_DSD_RATE: u32 = 45_158_400;
const MAX_CHANNELS: u16 = 32;
const MAX_ID3_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum DsdError {
    #[error("I/O error while reading DSD file {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Invalid {container} file: {details}")]
    Invalid {
        container: &'static str,
        details: String,
    },
    #[error("Unsupported DSD compression: {0}")]
    UnsupportedCompression(String),
}

pub type DsdResult<T> = Result<T, DsdError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DsdContainer {
    Dsf,
    Dff,
}

impl DsdContainer {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Dsf => "DSF",
            Self::Dff => "DFF",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DsdEncoding {
    Raw,
    Dst,
}

impl DsdEncoding {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Raw => "DSD",
            Self::Dst => "DST",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DstFrameIndex {
    pub offset: u64,
    pub length: u32,
}

#[derive(Debug, Clone)]
pub struct DsdFormat {
    pub container: DsdContainer,
    pub encoding: DsdEncoding,
    /// The actual one-bit sample rate stored in the file (2.8224 MHz for DSD64).
    pub dsd_sample_rate: u32,
    /// DSD decoders emit one PCM sample for each group of eight DSD
    /// bits, so this is the rate exposed by the PCM decoder.
    pub pcm_sample_rate: u32,
    pub dsd_rate: DsdRate,
    pub channels: u16,
    pub sample_count: u64,
    pub duration_ms: u64,
    pub data_offset: u64,
    pub data_size: u64,
    pub block_size: u32,
    pub lsb_first: bool,
    pub dst_frame_rate: Option<u32>,
    pub dst_frames: Vec<DstFrameIndex>,
    /// Complete ID3v2 data beginning at the ID3 header, when present.
    pub id3: Option<Vec<u8>>,
}

impl DsdFormat {
    pub fn codec_label(&self) -> String {
        format!("{} {}", self.dsd_rate.label(), self.encoding.label())
    }

    pub fn bytes_per_channel(&self) -> u64 {
        (self.sample_count.saturating_add(7)) / 8
    }

    pub fn quality_badge(&self, output_mode: DsdOutputMode) -> QualityBadge {
        QualityBadge {
            sample_rate: self.dsd_sample_rate,
            channels: self.channels,
            bit_depth: Some(1),
            bitrate_kbps: Some(
                ((u64::from(self.dsd_sample_rate) * u64::from(self.channels)) / 1000) as u32,
            ),
            codec_name: self.encoding.label().into(),
            container_format: if self.container == DsdContainer::Dff
                && self.encoding == DsdEncoding::Dst
            {
                "dff/dst".into()
            } else {
                self.container.label().to_ascii_lowercase()
            },
            is_lossless: true,
            is_hi_res: true,
            source_type: Some("DSD".into()),
            dsd_rate: Some(self.dsd_rate),
            dsd_output_mode: Some(output_mode),
        }
    }
}

pub fn dsd_rate_from_sample_rate(sample_rate: u32) -> DsdResult<DsdRate> {
    let candidates = [
        (DsdRate::Dsd64, 64u32),
        (DsdRate::Dsd128, 128),
        (DsdRate::Dsd256, 256),
        (DsdRate::Dsd512, 512),
        (DsdRate::Dsd1024, 1024),
    ];
    for (rate, multiplier) in candidates {
        if sample_rate == 44_100u32.saturating_mul(multiplier)
            || sample_rate == 48_000u32.saturating_mul(multiplier)
        {
            return Ok(rate);
        }
    }
    Err(DsdError::Invalid {
        container: "DSD",
        details: format!("unsupported DSD sample rate {sample_rate} Hz"),
    })
}

/// PCM rate after DSD → PCM.
///
/// A DSD bit clock (2.8224 / 3.072 MHz, …) maps through the shared FIR table
/// (`dsd_pcm_output_rate_hz`). A value that is already a PCM rate is passed
/// through so Exclusive / Gapless do not re-interpret 176.4 kHz as ultrasonic.
pub fn dsd_pcm_output_rate(rate: u32) -> u32 {
    if nnpm_audio_core::types::dsd_rate_from_sample_rate(rate).is_some() {
        return nnpm_audio_core::decimator::dsd_pcm_output_rate_hz(rate);
    }
    if rate >= 44_100 {
        rate
    } else {
        44_100
    }
}

pub fn probe_path(path: &Path) -> DsdResult<DsdFormat> {
    let mut file = File::open(path).map_err(|source| DsdError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let len = file
        .metadata()
        .map_err(|source| DsdError::Io {
            path: path.to_path_buf(),
            source,
        })?
        .len();
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(|source| DsdError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    file.seek(SeekFrom::Start(0))
        .map_err(|source| DsdError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    match &magic {
        b"DSD " => DsfReader::parse(&mut file, path, len),
        b"FRM8" => DsdiffReader::parse(&mut file, path, len).map(|reader| reader.format),
        _ => Err(DsdError::Invalid {
            container: "DSD",
            details: "missing DSF/DFF signature".into(),
        }),
    }
}

/// DSF reader. DSF payload is little-endian and stores channel data in
/// block-interleaved planes. `next_packet` exposes the same bytes as a
/// channel-interleaved, MSB-first DSD stream for the native ASIO path.
pub struct DsfReader {
    path: PathBuf,
    file: File,
    pub format: DsdFormat,
    physical_cursor: u64,
}

impl DsfReader {
    fn parse(file: &mut File, path: &Path, file_len: u64) -> DsdResult<DsdFormat> {
        let mut header = [0u8; 28];
        read_exact_path(file, path, &mut header)?;
        if &header[0..4] != b"DSD " || le_u64(&header[4..12]) != 28 {
            return invalid("DSF", "DSD header size must be 28 bytes");
        }
        let declared_file_size = le_u64(&header[12..20]);
        if declared_file_size != 0 && declared_file_size > file_len {
            return invalid("DSF", "declared file size exceeds the physical file");
        }
        let metadata_offset = le_u64(&header[20..28]);

        let mut fmt_header = [0u8; 12];
        read_exact_path(file, path, &mut fmt_header)?;
        if &fmt_header[0..4] != b"fmt " || le_u64(&fmt_header[4..12]) != 52 {
            return invalid("DSF", "fmt chunk is missing or has an invalid size");
        }
        let mut fmt = [0u8; 40];
        read_exact_path(file, path, &mut fmt)?;
        if le_u32(&fmt[0..4]) != 1 || le_u32(&fmt[4..8]) != 0 {
            return invalid("DSF", "unsupported fmt version or format id");
        }
        let channel_type = le_u32(&fmt[8..12]);
        let channels = le_u32(&fmt[12..16]) as u16;
        let dsd_sample_rate = le_u32(&fmt[16..20]);
        let bits_per_sample = le_u32(&fmt[20..24]);
        let sample_count = le_u64(&fmt[24..32]);
        let block_size = le_u32(&fmt[32..36]);
        let reserved = le_u32(&fmt[36..40]);
        if channel_type == 0
            || channels == 0
            || channels > MAX_CHANNELS
            || (bits_per_sample != 1 && bits_per_sample != 8)
            || block_size == 0
            || reserved != 0
        {
            return invalid(
                "DSF",
                "invalid channel, bit depth, block size, or reserved field",
            );
        }
        let dsd_rate = dsd_rate_from_sample_rate(dsd_sample_rate)?;
        let pcm_sample_rate = dsd_sample_rate / 8;

        let data_header_offset = file.stream_position().map_err(|source| DsdError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        read_exact_path(file, path, &mut fmt_header)?;
        if &fmt_header[0..4] != b"data" {
            return invalid("DSF", "data chunk is missing after fmt");
        }
        let data_chunk_size = le_u64(&fmt_header[4..12]);
        if data_chunk_size < 12 {
            return invalid("DSF", "data chunk is shorter than its header");
        }
        let data_size = data_chunk_size - 12;
        let data_offset = data_header_offset + 12;
        if data_offset > file_len || data_size > file_len - data_offset {
            return invalid("DSF", "data chunk exceeds the physical file");
        }
        let expected = u64::from(channels)
            .checked_mul(sample_count.div_ceil(8))
            .ok_or_else(|| invalid_value("DSF", "sample count overflows"))?;
        if data_size < expected {
            return invalid("DSF", "data chunk does not contain all declared samples");
        }

        let id3 = read_dsf_id3(file, path, metadata_offset, file_len)?;
        Ok(DsdFormat {
            container: DsdContainer::Dsf,
            encoding: DsdEncoding::Raw,
            dsd_sample_rate,
            pcm_sample_rate,
            dsd_rate,
            channels,
            sample_count,
            duration_ms: duration_ms(sample_count, dsd_sample_rate),
            data_offset,
            data_size,
            block_size,
            lsb_first: bits_per_sample == 1,
            dst_frame_rate: None,
            dst_frames: Vec::new(),
            id3,
        })
    }

    pub fn open(path: &Path) -> DsdResult<Self> {
        let mut file = File::open(path).map_err(|source| DsdError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let file_len = file
            .metadata()
            .map_err(|source| DsdError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .len();
        let format = Self::parse(&mut file, path, file_len)?;
        Ok(Self {
            path: path.to_path_buf(),
            file,
            format,
            physical_cursor: 0,
        })
    }

    /// Return channel-interleaved bytes. DSF with `bits_per_sample == 1` stores
    /// the first sample in the LSB; native ASIO/DoP/DSD_MSBF use MSB-first, so
    /// those bytes are bit-reversed. `bits_per_sample == 8` is already MSB-first.
    pub fn next_packet(&mut self, max_bytes: usize) -> DsdResult<Option<Vec<u8>>> {
        let channels = usize::from(self.format.channels.max(1));
        let bytes_per_channel = self.format.bytes_per_channel() as usize;
        let block_size = self.format.block_size as usize;
        let physical_block = block_size.saturating_mul(channels);
        if physical_block == 0 {
            return invalid("DSF", "block size overflows the channel layout");
        }

        let max_output = max_bytes
            .max(channels)
            .saturating_sub(max_bytes.max(channels) % channels);
        let mut output = Vec::with_capacity(max_output.max(channels));
        while output.len() < max_output {
            let block_index = self.physical_cursor / physical_block as u64;
            let block_channel_start = (block_index as usize).saturating_mul(block_size);
            if block_channel_start >= bytes_per_channel {
                break;
            }
            let channel_bytes = (bytes_per_channel - block_channel_start).min(block_size);
            let remaining_physical = self.format.data_size.saturating_sub(self.physical_cursor);
            if remaining_physical == 0 {
                break;
            }
            let read_len = remaining_physical.min(physical_block as u64) as usize;
            let mut physical = vec![0x55u8; physical_block];
            read_at(
                &mut self.file,
                &self.path,
                self.format.data_offset + self.physical_cursor,
                &mut physical[..read_len],
            )?;

            for byte_index in 0..channel_bytes {
                for channel in 0..channels {
                    let offset = channel.saturating_mul(block_size) + byte_index;
                    let raw = physical.get(offset).copied().unwrap_or(0x55);
                    output.push(if self.format.lsb_first {
                        raw.reverse_bits()
                    } else {
                        raw
                    });
                }
            }
            self.physical_cursor = self.physical_cursor.saturating_add(physical_block as u64);
        }

        if output.is_empty() {
            Ok(None)
        } else {
            Ok(Some(output))
        }
    }

    /// One DSF physical block as channel-planar bytes for the decoder
    /// `DSD_LSBF_PLANAR` / `DSD_MSBF_PLANAR`. Matches `dsfdec`: each packet is
    /// `[ch0 block][ch1 block]` of equal valid length, never several blocks
    /// concatenated (that would be misread as two huge planes).
    pub fn next_planar_block(&mut self) -> DsdResult<Option<Vec<u8>>> {
        let channels = usize::from(self.format.channels.max(1));
        let bytes_per_channel = self.format.bytes_per_channel() as usize;
        let block_size = self.format.block_size as usize;
        let physical_block = block_size.saturating_mul(channels);
        if physical_block == 0 {
            return invalid("DSF", "block size overflows the channel layout");
        }

        let block_index = self.physical_cursor / physical_block as u64;
        let block_channel_start = (block_index as usize).saturating_mul(block_size);
        if block_channel_start >= bytes_per_channel {
            return Ok(None);
        }
        let channel_bytes = (bytes_per_channel - block_channel_start).min(block_size);
        let remaining_physical = self.format.data_size.saturating_sub(self.physical_cursor);
        if remaining_physical == 0 || channel_bytes == 0 {
            return Ok(None);
        }
        let read_len = remaining_physical.min(physical_block as u64) as usize;
        let mut physical = vec![0x55u8; physical_block];
        read_at(
            &mut self.file,
            &self.path,
            self.format.data_offset + self.physical_cursor,
            &mut physical[..read_len],
        )?;

        let mut output = Vec::with_capacity(channel_bytes.saturating_mul(channels));
        for channel in 0..channels {
            let start = channel.saturating_mul(block_size);
            let plane = physical
                .get(start..start.saturating_add(channel_bytes))
                .unwrap_or(&[]);
            output.extend_from_slice(plane);
            if plane.len() < channel_bytes {
                output.resize(output.len() + (channel_bytes - plane.len()), 0x55);
            }
        }
        self.physical_cursor = self.physical_cursor.saturating_add(physical_block as u64);
        if output.is_empty() {
            Ok(None)
        } else {
            Ok(Some(output))
        }
    }

    pub fn seek_ms(&mut self, target_ms: u64) {
        let target_samples =
            target_ms.saturating_mul(u64::from(self.format.dsd_sample_rate)) / 1000;
        let byte = (target_samples / 8).min(self.format.bytes_per_channel());
        let block_size = u64::from(self.format.block_size.max(1));
        let block = byte / block_size;
        self.physical_cursor = block
            .saturating_mul(block_size)
            .saturating_mul(u64::from(self.format.channels));
    }

    pub fn path_for_error(&self) -> PathBuf {
        self.path.clone()
    }
}

/// DSDIFF/DFF parser and sequential packet reader. It understands both the
/// raw `DSD ` chunk and the nested `DST`/`DSTI`/`DSTF` representation.
pub struct DsdiffReader {
    path: PathBuf,
    file: File,
    pub format: DsdFormat,
    raw_cursor: u64,
    dst_cursor: usize,
    dst_chunks: Vec<Chunk>,
    indexed_dst_frames: Vec<DstFrameIndex>,
}

#[derive(Debug, Clone, Copy)]
struct Chunk {
    offset: u64,
    size: u64,
}

#[derive(Default)]
struct DffScan {
    fver: Option<u32>,
    prop: bool,
    fs: Option<u32>,
    channels: Option<u16>,
    compression: Option<[u8; 4]>,
    frame_rate: Option<u32>,
    frame_count: Option<u32>,
    raw: Option<Chunk>,
    dst_container: Option<Chunk>,
    dst_frames: Vec<Chunk>,
    dst_index: Vec<DstFrameIndex>,
    id3: Option<Vec<u8>>,
}

impl DsdiffReader {
    fn parse(file: &mut File, path: &Path, file_len: u64) -> DsdResult<Self> {
        let mut outer = [0u8; 16];
        read_exact_path(file, path, &mut outer)?;
        if &outer[0..4] != b"FRM8" || &outer[12..16] != b"DSD " {
            return invalid("DFF", "FRM8 form type must be DSD ");
        }
        let form_size = be_u64(&outer[4..12]);
        if form_size < 4 || 12u64.saturating_add(form_size) > file_len {
            return invalid("DFF", "FRM8 size exceeds the physical file");
        }
        let mut scan = DffScan::default();
        scan_chunks(file, path, 16, 12 + form_size, &mut scan, 0)?;

        if scan.fver.is_none() {
            return invalid("DFF", "FVER chunk is missing or unsupported");
        }
        if !scan.prop {
            return invalid("DFF", "PROP chunk is missing");
        }

        let dsd_sample_rate = scan
            .fs
            .ok_or_else(|| invalid_value("DFF", "PROP/FS chunk is missing"))?;
        let channels = scan
            .channels
            .ok_or_else(|| invalid_value("DFF", "PROP/CHNL chunk is missing"))?;
        if channels == 0 || channels > MAX_CHANNELS {
            return invalid("DFF", "invalid channel count");
        }
        if dsd_sample_rate == 0 || dsd_sample_rate > MAX_DSD_RATE {
            return invalid("DFF", "invalid DSD sample rate");
        }
        let dsd_rate = dsd_rate_from_sample_rate(dsd_sample_rate)?;
        if let Some(compression) = scan.compression {
            if compression != *b"DSD " && compression != *b"DST " {
                return Err(DsdError::UnsupportedCompression(
                    String::from_utf8_lossy(&compression).trim().to_string(),
                ));
            }
        }
        let has_raw = scan.raw.is_some();
        let has_dst = !scan.dst_frames.is_empty() || scan.dst_container.is_some();
        if has_raw && has_dst {
            return invalid("DFF", "both raw DSD and DST sound data are present");
        }
        if let Some(compression) = scan.compression {
            if has_raw && compression == *b"DST " {
                return invalid(
                    "DFF",
                    "CMPR declares DST but the file contains raw DSD data",
                );
            }
            if has_dst && compression == *b"DSD " {
                return invalid(
                    "DFF",
                    "CMPR declares raw DSD but the file contains DST data",
                );
            }
        }
        let mut dst_chunks = Vec::new();
        let has_dst_index = !scan.dst_index.is_empty();
        let (encoding, data_offset, data_size, dst_index, sample_count) =
            if let Some(raw) = scan.raw {
                if raw.size % u64::from(channels) != 0 {
                    return invalid("DFF", "raw DSD data is not aligned to channel count");
                }
                let bytes_per_channel = raw.size / u64::from(channels);
                let samples = bytes_per_channel.saturating_mul(8);
                (DsdEncoding::Raw, raw.offset, raw.size, Vec::new(), samples)
            } else {
                let frames = if scan.dst_frames.is_empty() {
                    if let Some(container) = scan.dst_container {
                        vec![Chunk {
                            offset: container.offset,
                            size: container.size,
                        }]
                    } else {
                        Vec::new()
                    }
                } else {
                    scan.dst_frames
                };
                if frames.is_empty() {
                    return invalid("DFF", "neither DSD nor DST sound data was found");
                }
                let frame_rate = scan.frame_rate.unwrap_or(75);
                if frame_rate == 0 {
                    return invalid("DFF", "DST frame rate is zero");
                }
                let samples_per_frame = u64::from(dsd_sample_rate) / u64::from(frame_rate);
                let samples = scan
                    .frame_count
                    .map(u64::from)
                    .unwrap_or(frames.len() as u64)
                    .saturating_mul(samples_per_frame);
                let offset = frames.first().map(|c| c.offset).unwrap_or(0);
                let size = frames.iter().map(|c| c.size).sum();
                let indices = if !has_dst_index {
                    frames
                        .iter()
                        .map(|c| DstFrameIndex {
                            offset: c.offset,
                            length: c.size.min(u64::from(u32::MAX)) as u32,
                        })
                        .collect()
                } else {
                    if scan.dst_index.len() != frames.len() {
                        return invalid("DFF", "DSTI entry count does not match DST frames");
                    }
                    scan.dst_index
                };
                for index in &indices {
                    let end = index
                        .offset
                        .checked_add(u64::from(index.length))
                        .ok_or_else(|| invalid_value("DFF", "DSTI offset overflows"))?;
                    if index.length == 0 || end > file_len {
                        return invalid("DFF", "DSTI points outside the physical file");
                    }
                }
                dst_chunks = frames;
                (DsdEncoding::Dst, offset, size, indices, samples)
            };
        let dst_frame_indices = if encoding == DsdEncoding::Dst {
            dst_index
        } else {
            Vec::new()
        };

        let format = DsdFormat {
            container: DsdContainer::Dff,
            encoding,
            dsd_sample_rate,
            pcm_sample_rate: dsd_sample_rate / 8,
            dsd_rate,
            channels,
            sample_count,
            duration_ms: duration_ms(sample_count, dsd_sample_rate),
            data_offset,
            data_size,
            block_size: 0,
            lsb_first: false,
            dst_frame_rate: scan.frame_rate,
            dst_frames: dst_frame_indices,
            id3: scan.id3,
        };

        // Rebuild the physical frame list from the scan when DST is used. The
        // indices are for seeking; actual packet reads use the concrete chunks.
        let mut reader = Self {
            path: path.to_path_buf(),
            file: file.try_clone().map_err(|source| DsdError::Io {
                path: path.to_path_buf(),
                source,
            })?,
            format,
            raw_cursor: 0,
            dst_cursor: 0,
            dst_chunks: Vec::new(),
            indexed_dst_frames: Vec::new(),
        };
        if encoding == DsdEncoding::Dst {
            reader.dst_chunks = dst_chunks;
            if has_dst_index {
                reader.indexed_dst_frames = reader.format.dst_frames.clone();
            }
        }
        Ok(reader)
    }
}

impl DsdiffReader {
    pub fn open(path: &Path) -> DsdResult<Self> {
        let mut file = File::open(path).map_err(|source| DsdError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let len = file
            .metadata()
            .map_err(|source| DsdError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .len();
        Self::parse(&mut file, path, len)
    }

    pub fn next_packet(&mut self, max_bytes: usize) -> DsdResult<Option<Vec<u8>>> {
        match self.format.encoding {
            DsdEncoding::Raw => {
                let remaining = self.format.data_size.saturating_sub(self.raw_cursor);
                if remaining == 0 {
                    return Ok(None);
                }
                let channels = u64::from(self.format.channels.max(1));
                let mut size = remaining.min(max_bytes.max(channels as usize) as u64);
                size -= size % channels;
                if size == 0 {
                    return invalid("DFF", "raw DSD data is not aligned to channel count");
                }
                let mut bytes = vec![0u8; size as usize];
                self.file
                    .seek(SeekFrom::Start(self.format.data_offset + self.raw_cursor))
                    .map_err(|source| self.io(source))?;
                self.file
                    .read_exact(&mut bytes)
                    .map_err(|source| self.io(source))?;
                self.raw_cursor += size;
                Ok(Some(bytes))
            }
            DsdEncoding::Dst => {
                let (offset, size) =
                    if let Some(index) = self.indexed_dst_frames.get(self.dst_cursor) {
                        (index.offset, u64::from(index.length))
                    } else if let Some(chunk) = self.dst_chunks.get(self.dst_cursor).copied() {
                        (chunk.offset, chunk.size)
                    } else {
                        return Ok(None);
                    };
                self.dst_cursor += 1;
                if size == 0 || size > i32::MAX as u64 {
                    return invalid("DFF", "DST frame size is invalid");
                }
                let mut bytes = vec![0u8; size as usize];
                self.file
                    .seek(SeekFrom::Start(offset))
                    .map_err(|source| self.io(source))?;
                self.file
                    .read_exact(&mut bytes)
                    .map_err(|source| self.io(source))?;
                Ok(Some(bytes))
            }
        }
    }

    pub fn seek_ms(&mut self, target_ms: u64) {
        let target_samples =
            target_ms.saturating_mul(u64::from(self.format.dsd_sample_rate)) / 1000;
        match self.format.encoding {
            DsdEncoding::Raw => {
                self.raw_cursor = (target_samples / 8)
                    .saturating_mul(u64::from(self.format.channels))
                    .min(self.format.data_size);
                self.raw_cursor -= self.raw_cursor % u64::from(self.format.channels.max(1));
            }
            DsdEncoding::Dst => {
                let frame_samples = u64::from(self.format.dsd_sample_rate)
                    / u64::from(self.format.dst_frame_rate.unwrap_or(75).max(1));
                self.dst_cursor = (target_samples / frame_samples.max(1)) as usize;
                self.dst_cursor = self.dst_cursor.min(self.dst_chunks.len());
            }
        }
    }

    fn io(&self, source: std::io::Error) -> DsdError {
        DsdError::Io {
            path: self.path.clone(),
            source,
        }
    }

    pub fn path_for_error(&self) -> PathBuf {
        self.path.clone()
    }
}

fn scan_chunks(
    file: &mut File,
    path: &Path,
    start: u64,
    end: u64,
    scan: &mut DffScan,
    depth: u8,
) -> DsdResult<()> {
    if depth > 4 {
        return invalid("DFF", "chunk nesting is too deep");
    }
    let mut pos = start;
    while pos < end {
        if end - pos < 12 {
            return invalid("DFF", "truncated chunk header");
        }
        file.seek(SeekFrom::Start(pos))
            .map_err(|source| DsdError::Io {
                path: path.to_path_buf(),
                source,
            })?;
        let mut header = [0u8; 12];
        read_exact_path(file, path, &mut header)?;
        let mut id = [0u8; 4];
        id.copy_from_slice(&header[0..4]);
        let size = be_u64(&header[4..12]);
        let payload = pos + 12;
        let padded = payload
            .checked_add(size)
            .and_then(|v| v.checked_add(size & 1))
            .ok_or_else(|| invalid_value("DFF", "chunk size overflows"))?;
        if padded > end {
            return invalid("DFF", "chunk payload exceeds its containing form");
        }
        let chunk = Chunk {
            offset: payload,
            size,
        };
        match &id {
            b"PROP" => {
                scan.prop = true;
                if size < 4 {
                    return invalid("DFF", "PROP chunk is missing its form type");
                }
                scan_chunks(file, path, payload + 4, payload + size, scan, depth + 1)?;
            }
            b"FVER" => {
                if size < 4 {
                    return invalid("DFF", "FVER chunk is shorter than four bytes");
                }
                let version = read_u32_at(file, path, payload, true)?;
                if version != 0x0104_0000 && version != 0x0105_0000 {
                    return invalid("DFF", format!("unsupported FVER 0x{version:08x}"));
                }
                scan.fver = Some(version);
            }
            b"DST " => {
                scan.dst_container = Some(chunk);
                if size >= 12 && looks_like_chunk(file, path, payload, payload + size)? {
                    scan_chunks(file, path, payload, payload + size, scan, depth + 1)?;
                }
            }
            b"FS  " => {
                if size >= 4 {
                    scan.fs = Some(read_u32_at(file, path, payload, true)?);
                }
            }
            b"CHNL" => {
                if size >= 2 {
                    scan.channels = Some(read_u16_at(file, path, payload, true)?);
                }
            }
            b"CMPR" => {
                if size >= 4 {
                    let mut compression = [0u8; 4];
                    read_at(file, path, payload, &mut compression)?;
                    scan.compression = Some(compression);
                }
            }
            b"FRTE" => {
                if size >= 6 {
                    scan.frame_count = Some(read_u32_at(file, path, payload, true)?);
                    scan.frame_rate = Some(read_u16_at(file, path, payload + 4, true)? as u32);
                }
            }
            b"DSD " => scan.raw = Some(chunk),
            b"DSTF" => scan.dst_frames.push(chunk),
            b"DSTI" => parse_dsti(file, path, chunk, scan)?,
            b"ID3 " if size <= MAX_ID3_BYTES => {
                let mut data = vec![0u8; size as usize];
                read_at(file, path, payload, &mut data)?;
                scan.id3 = Some(data);
            }
            _ => {}
        }
        pos = padded;
    }
    Ok(())
}

fn looks_like_chunk(file: &mut File, path: &Path, start: u64, end: u64) -> DsdResult<bool> {
    if end - start < 12 {
        return Ok(false);
    }
    let mut header = [0u8; 12];
    read_at(file, path, start, &mut header)?;
    let id = &header[0..4];
    let size = be_u64(&header[4..12]);
    let recognized = matches!(
        id,
        b"DSTI" | b"DSTF" | b"DSTC" | b"DST " | b"FRTE" | b"ID3 "
    );
    Ok(recognized && 12u64.saturating_add(size) <= end - start)
}

fn parse_dsti(file: &mut File, path: &Path, chunk: Chunk, scan: &mut DffScan) -> DsdResult<()> {
    // DSDIFF 1.5 stores each index as a big-endian u64 file offset followed
    // by a big-endian u32 length. Ignore a trailing pad byte, never guess at
    // malformed partial entries.
    if chunk.size % 12 != 0 {
        return invalid("DFF", "DSTI size is not a multiple of 12 bytes");
    }
    let count = chunk.size / 12;
    if count > usize::MAX as u64 {
        return invalid("DFF", "DSTI contains too many entries");
    }
    for index in 0..count {
        let offset = chunk.offset + index * 12;
        let file_offset = read_u64_at(file, path, offset, true)?;
        let length = read_u32_at(file, path, offset + 8, true)?;
        scan.dst_index.push(DstFrameIndex {
            offset: file_offset,
            length,
        });
    }
    Ok(())
}

fn read_dsf_id3(
    file: &mut File,
    path: &Path,
    metadata_offset: u64,
    file_len: u64,
) -> DsdResult<Option<Vec<u8>>> {
    if metadata_offset == 0
        || metadata_offset >= file_len
        || file_len - metadata_offset > MAX_ID3_BYTES
    {
        return Ok(None);
    }
    let mut magic = [0u8; 3];
    read_at(file, path, metadata_offset, &mut magic)?;
    if &magic != b"ID3" {
        return Ok(None);
    }
    let size = file_len - metadata_offset;
    let mut data = vec![0u8; size as usize];
    read_at(file, path, metadata_offset, &mut data)?;
    Ok(Some(data))
}

fn duration_ms(samples: u64, rate: u32) -> u64 {
    if rate == 0 {
        return 0;
    }
    samples.saturating_mul(1000) / u64::from(rate)
}

fn read_exact_path(file: &mut File, path: &Path, dst: &mut [u8]) -> DsdResult<()> {
    file.read_exact(dst).map_err(|source| DsdError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn read_at(file: &mut File, path: &Path, offset: u64, dst: &mut [u8]) -> DsdResult<()> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|source| DsdError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    read_exact_path(file, path, dst)
}

fn read_u16_at(file: &mut File, path: &Path, offset: u64, big_endian: bool) -> DsdResult<u16> {
    let mut bytes = [0u8; 2];
    read_at(file, path, offset, &mut bytes)?;
    Ok(if big_endian {
        u16::from_be_bytes(bytes)
    } else {
        u16::from_le_bytes(bytes)
    })
}

fn read_u32_at(file: &mut File, path: &Path, offset: u64, big_endian: bool) -> DsdResult<u32> {
    let mut bytes = [0u8; 4];
    read_at(file, path, offset, &mut bytes)?;
    Ok(if big_endian {
        u32::from_be_bytes(bytes)
    } else {
        u32::from_le_bytes(bytes)
    })
}

fn read_u64_at(file: &mut File, path: &Path, offset: u64, big_endian: bool) -> DsdResult<u64> {
    let mut bytes = [0u8; 8];
    read_at(file, path, offset, &mut bytes)?;
    Ok(if big_endian {
        u64::from_be_bytes(bytes)
    } else {
        u64::from_le_bytes(bytes)
    })
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().unwrap())
}

fn le_u64(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().unwrap())
}

fn be_u64(bytes: &[u8]) -> u64 {
    u64::from_be_bytes(bytes.try_into().unwrap())
}

fn invalid<T>(container: &'static str, details: impl Into<String>) -> DsdResult<T> {
    Err(DsdError::Invalid {
        container,
        details: details.into(),
    })
}

fn invalid_value(container: &'static str, details: impl Into<String>) -> DsdError {
    DsdError::Invalid {
        container,
        details: details.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn dsf_fixture() -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"DSD ");
        data.extend_from_slice(&28u64.to_le_bytes());
        data.extend_from_slice(&124u64.to_le_bytes());
        data.extend_from_slice(&0u64.to_le_bytes());
        data.extend_from_slice(b"fmt ");
        data.extend_from_slice(&52u64.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&2_822_400u32.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&64u64.to_le_bytes());
        data.extend_from_slice(&4096u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(b"data");
        data.extend_from_slice(&44u64.to_le_bytes());
        data.extend_from_slice(&[0x69; 32]);
        data
    }

    fn dff_chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut chunk = Vec::with_capacity(12 + payload.len() + payload.len() % 2);
        chunk.extend_from_slice(id);
        chunk.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        chunk.extend_from_slice(payload);
        if payload.len() % 2 != 0 {
            chunk.push(0);
        }
        chunk
    }

    fn dff_prop_with_compression(compression: &[u8; 4]) -> Vec<u8> {
        let mut payload = b"SND ".to_vec();
        payload.extend(dff_chunk(b"FS  ", &2_822_400u32.to_be_bytes()));
        payload.extend(dff_chunk(
            b"CHNL",
            &[0, 2, b'S', b'L', b'F', b'L', b'S', b'R'],
        ));
        payload.extend(dff_chunk(b"CMPR", compression));
        dff_chunk(b"PROP", &payload)
    }

    fn dff_fixture(dst: bool) -> Vec<u8> {
        let mut inner = dff_prop_with_compression(if dst { b"DST " } else { b"DSD " });
        inner.extend(dff_chunk(b"FVER", &0x0105_0000u32.to_be_bytes()));
        if dst {
            let mut dst_payload = Vec::new();
            dst_payload.extend(dff_chunk(b"FRTE", &[0, 0, 0, 1, 0, 75, 0, 0]));
            dst_payload.extend(dff_chunk(b"DSTF", &[0x00, 0x00, 0x00, 0x00]));
            inner.extend(dff_chunk(b"DST ", &dst_payload));
        } else {
            inner.extend(dff_chunk(b"DSD ", &[0x69; 16]));
        }
        let mut file = b"FRM8".to_vec();
        let form_size = 4 + inner.len();
        file.extend_from_slice(&(form_size as u64).to_be_bytes());
        file.extend_from_slice(b"DSD ");
        file.extend(inner);
        file
    }

    #[test]
    fn parses_dsf_header_and_padding_safe_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.DSF");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(&dsf_fixture()).unwrap();
        let format = probe_path(&path).unwrap();
        assert_eq!(format.container, DsdContainer::Dsf);
        assert_eq!(format.dsd_rate, DsdRate::Dsd64);
        assert_eq!(format.channels, 2);
        assert_eq!(format.duration_ms, 0);
        assert_eq!(format.data_size, 32);
    }

    #[test]
    fn dsf_reader_preserves_block_channel_order_and_normalizes_bit_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ordered.dsf");
        let mut bytes = dsf_fixture();
        bytes[64..72].copy_from_slice(&32u64.to_le_bytes());
        bytes[72..76].copy_from_slice(&2u32.to_le_bytes());
        bytes[84..92].copy_from_slice(&20u64.to_le_bytes());
        bytes.truncate(92);
        bytes[84..].copy_from_slice(&20u64.to_le_bytes());
        bytes.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        let file_len = bytes.len() as u64;
        bytes[12..20].copy_from_slice(&file_len.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let mut reader = DsfReader::open(&path).unwrap();
        assert_eq!(
            reader.next_packet(8).unwrap().unwrap(),
            vec![0x80, 0xC0, 0x40, 0x20, 0xA0, 0xE0, 0x60, 0x10]
        );
        assert!(reader.next_packet(8).unwrap().is_none());
    }

    #[test]
    fn dsf_planar_block_keeps_channel_planes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("planar.dsf");
        let mut bytes = dsf_fixture();
        bytes[64..72].copy_from_slice(&32u64.to_le_bytes());
        bytes[72..76].copy_from_slice(&2u32.to_le_bytes());
        bytes.truncate(92);
        bytes[84..].copy_from_slice(&20u64.to_le_bytes());
        bytes.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        let file_len = bytes.len() as u64;
        bytes[12..20].copy_from_slice(&file_len.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let mut reader = DsfReader::open(&path).unwrap();
        assert_eq!(
            reader.next_planar_block().unwrap().unwrap(),
            vec![1, 2, 3, 4]
        );
        assert_eq!(
            reader.next_planar_block().unwrap().unwrap(),
            vec![5, 6, 7, 8]
        );
        assert!(reader.next_planar_block().unwrap().is_none());
    }

    #[test]
    fn dsf_bits_per_sample_8_is_already_msb_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("msb.dsf");
        let mut bytes = dsf_fixture();
        bytes[60..64].copy_from_slice(&8u32.to_le_bytes());
        bytes[64..72].copy_from_slice(&32u64.to_le_bytes());
        bytes[72..76].copy_from_slice(&2u32.to_le_bytes());
        bytes.truncate(92);
        bytes[84..].copy_from_slice(&20u64.to_le_bytes());
        bytes.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        let file_len = bytes.len() as u64;
        bytes[12..20].copy_from_slice(&file_len.to_le_bytes());
        std::fs::write(&path, bytes).unwrap();

        let mut reader = DsfReader::open(&path).unwrap();
        assert!(!reader.format.lsb_first);
        assert_eq!(
            reader.next_packet(8).unwrap().unwrap(),
            vec![1, 3, 2, 4, 5, 7, 6, 8]
        );
    }

    #[test]
    fn recognizes_all_supported_dsd_rates() {
        assert_eq!(
            dsd_rate_from_sample_rate(2_822_400).unwrap(),
            DsdRate::Dsd64
        );
        assert_eq!(
            dsd_rate_from_sample_rate(5_644_800).unwrap(),
            DsdRate::Dsd128
        );
        assert_eq!(
            dsd_rate_from_sample_rate(11_289_600).unwrap(),
            DsdRate::Dsd256
        );
        assert_eq!(
            dsd_rate_from_sample_rate(22_579_200).unwrap(),
            DsdRate::Dsd512
        );
        assert_eq!(
            dsd_rate_from_sample_rate(3_072_000).unwrap(),
            DsdRate::Dsd64
        );
        assert_eq!(
            dsd_rate_from_sample_rate(6_144_000).unwrap(),
            DsdRate::Dsd128
        );
        assert_eq!(
            DsdRate::Dsd64.sample_rate_families_hz(),
            [2_822_400, 3_072_000]
        );
        assert!(dsd_rate_from_sample_rate(192_000).is_err());
    }

    #[test]
    fn dsd_pcm_output_rate_maps_dsd_clock_and_passthroughs_pcm() {
        assert_eq!(dsd_pcm_output_rate(2_822_400), 176_400);
        assert_eq!(dsd_pcm_output_rate(3_072_000), 192_000);
        assert_eq!(dsd_pcm_output_rate(5_644_800), 352_800);
        assert_eq!(dsd_pcm_output_rate(11_289_600), 352_800);
        assert_eq!(dsd_pcm_output_rate(22_579_200), 352_800);
        assert_eq!(dsd_pcm_output_rate(45_158_400), 352_800);
        assert_eq!(dsd_pcm_output_rate(176_400), 176_400);
        assert_eq!(dsd_pcm_output_rate(352_800), 352_800);
        assert_eq!(dsd_pcm_output_rate(48_000), 48_000);
    }

    #[test]
    fn rejects_dsf_wrong_data_chunk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.dsf");
        let mut bytes = dsf_fixture();
        bytes[80..84].copy_from_slice(b"nope");
        std::fs::write(&path, bytes).unwrap();
        assert!(probe_path(&path).is_err());
    }

    #[test]
    fn parses_dff_raw_and_big_endian_chunk_padding() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.DFF");
        std::fs::write(&path, dff_fixture(false)).unwrap();
        let format = probe_path(&path).unwrap();
        assert_eq!(format.container, DsdContainer::Dff);
        assert_eq!(format.encoding, DsdEncoding::Raw);
        assert_eq!(format.dsd_rate, DsdRate::Dsd64);
        assert_eq!(format.channels, 2);
        assert_eq!(format.data_size, 16);
    }

    #[test]
    fn parses_dff_dst_frames_and_indexable_duration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.dff");
        std::fs::write(&path, dff_fixture(true)).unwrap();
        let format = probe_path(&path).unwrap();
        assert_eq!(format.encoding, DsdEncoding::Dst);
        assert_eq!(format.dst_frame_rate, Some(75));
        assert_eq!(format.dst_frames.len(), 1);
        assert_eq!(format.duration_ms, 13);
        assert_eq!(
            format.quality_badge(DsdOutputMode::Pcm).container_format,
            "dff/dst"
        );
    }

    #[test]
    fn reports_unsupported_dff_compression() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("unsupported.dff");
        let mut bytes = dff_fixture(false);
        let offset = bytes.windows(4).position(|chunk| chunk == b"CMPR").unwrap() + 12;
        bytes[offset..offset + 4].copy_from_slice(b"MP3 ");
        std::fs::write(&path, bytes).unwrap();
        let error = probe_path(&path).unwrap_err();
        assert!(matches!(error, DsdError::UnsupportedCompression(value) if value == "MP3"));
    }

    #[test]
    fn reads_dst_frames_using_dsti_offsets() {
        let fver = dff_chunk(b"FVER", &0x0105_0000u32.to_be_bytes());
        let prop = dff_prop_with_compression(b"DST ");
        let frte = dff_chunk(b"FRTE", &[0, 0, 0, 2, 0, 75, 0, 0]);
        let frame_one = dff_chunk(b"DSTF", &[1, 2, 3, 4]);
        let frame_two = dff_chunk(b"DSTF", &[5, 6, 7, 8]);
        let dst_payload = [frte.as_slice(), frame_one.as_slice(), frame_two.as_slice()].concat();
        let dst = dff_chunk(b"DST ", &dst_payload);

        // DSTI stores absolute file offsets to the sound bytes, not to the
        // DSTF chunk headers. Reverse the entries so the reader must honor
        // the index instead of silently following physical chunk order.
        let dsti_size = 24usize;
        let dsti_chunk_len = 12 + dsti_size;
        let frame_one_offset = 16 + fver.len() + prop.len() + dsti_chunk_len + 12 + frte.len() + 12;
        let frame_two_offset = frame_one_offset + frame_one.len();
        let mut dsti_payload = Vec::new();
        dsti_payload.extend_from_slice(&(frame_two_offset as u64).to_be_bytes());
        dsti_payload.extend_from_slice(&4u32.to_be_bytes());
        dsti_payload.extend_from_slice(&(frame_one_offset as u64).to_be_bytes());
        dsti_payload.extend_from_slice(&4u32.to_be_bytes());
        let dsti = dff_chunk(b"DSTI", &dsti_payload);

        let mut inner = fver;
        inner.extend(prop);
        inner.extend(dsti);
        inner.extend(dst);
        let mut bytes = b"FRM8".to_vec();
        bytes.extend_from_slice(&((4 + inner.len()) as u64).to_be_bytes());
        bytes.extend_from_slice(b"DSD ");
        bytes.extend(inner);
        assert_eq!(
            &bytes[frame_one_offset..frame_one_offset + 4],
            &[1, 2, 3, 4]
        );
        assert_eq!(
            &bytes[frame_two_offset..frame_two_offset + 4],
            &[5, 6, 7, 8]
        );

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("indexed.dff");
        std::fs::write(&path, bytes).unwrap();
        let mut reader = DsdiffReader::open(&path).unwrap();
        assert_eq!(reader.format.dst_frames.len(), 2);
        assert_eq!(reader.next_packet(64).unwrap().unwrap(), vec![5, 6, 7, 8]);
        assert_eq!(reader.next_packet(64).unwrap().unwrap(), vec![1, 2, 3, 4]);
        assert!(reader.next_packet(64).unwrap().is_none());
    }
}

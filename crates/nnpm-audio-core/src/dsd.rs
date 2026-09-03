//! DSD source trait and DSF/DFF header/stream parser (I/O-agnostic).

use std::io::{Read, Seek, SeekFrom};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::source::MediaSource;
use crate::types::{dsd_rate_from_sample_rate, DsdRate};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DstStatus {
    None,
    Stable,
    Experimental,
    Unsupported,
}

#[derive(Debug, Clone)]
pub struct DsdBlock {
    /// Channel-byte-interleaved DSD: byte `i` is eight 1-bit samples of
    /// channel `i % channels`. DSF planar blocks must be deinterleaved first.
    pub bytes: Vec<u8>,
    pub channels: u16,
    pub dsd_rate: DsdRate,
    pub lsb_first: bool,
    pub timestamp_ms: u64,
    pub dst: DstStatus,
}

pub trait DsdSource {
    fn info(&self) -> &DsdFormat;
    fn next_block(&mut self, max_bytes: usize) -> CoreResult<Option<DsdBlock>>;
    fn seek_ms(&mut self, target_ms: u64) -> CoreResult<u64>;
    fn flush(&mut self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DsdContainer {
    Dsf,
    Dff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DsdEncoding {
    Raw,
    Dst,
}

#[derive(Debug, Clone)]
pub struct DsdFormat {
    pub container: DsdContainer,
    pub encoding: DsdEncoding,
    pub dsd_sample_rate: u32,
    pub dsd_rate: DsdRate,
    pub channels: u16,
    pub sample_count: u64,
    pub duration_ms: u64,
    pub data_offset: u64,
    pub data_size: u64,
    pub block_size: u32,
    pub lsb_first: bool,
    pub dst_status: DstStatus,
}

impl DsdFormat {
    pub fn bytes_per_channel(&self) -> u64 {
        self.sample_count.saturating_add(7) / 8
    }

    pub fn physical_block_bytes(&self) -> u64 {
        u64::from(self.block_size.max(1)).saturating_mul(u64::from(self.channels.max(1)))
    }

    pub fn dst_status_for_rate(rate: DsdRate, encoding: DsdEncoding) -> DstStatus {
        if encoding != DsdEncoding::Dst {
            return DstStatus::None;
        }
        match rate {
            DsdRate::Dsd64 => DstStatus::Stable,
            DsdRate::Dsd128 | DsdRate::Dsd256 => DstStatus::Experimental,
            DsdRate::Dsd512 | DsdRate::Dsd1024 => DstStatus::Unsupported,
        }
    }
}

pub fn parse_header(bytes: &[u8], file_len: u64) -> CoreResult<DsdFormat> {
    if bytes.len() < 4 {
        return Err(CoreError::Unsupported("DSD header is truncated".into()));
    }
    match &bytes[0..4] {
        b"DSD " => parse_dsf(bytes, file_len),
        b"FRM8" => parse_dff(bytes),
        _ => Err(CoreError::Unsupported("missing DSF/DFF signature".into())),
    }
}

/// Convert DSF block-planar bytes to channel-byte-interleaved.
///
/// Each physical block is `[ch0: block_size][ch1: block_size]…`. Output byte
/// `i` is channel `i % channels` (what [`crate::decimator::unpack_dsd_bytes`]
/// expects). Does not reverse bits — `lsb_first` stays a FIR concern.
/// Trailing bytes shorter than one physical block are ignored. Padding past
/// `bytes_per_channel` is dropped.
pub fn deinterleave_dsf_planar(
    physical: &[u8],
    channels: u16,
    block_size: u32,
    mut consumed_per_channel: usize,
    bytes_per_channel: usize,
) -> Vec<u8> {
    let ch = usize::from(channels.max(1));
    let block_size = block_size.max(1) as usize;
    let physical_block = block_size.saturating_mul(ch);
    if physical_block == 0 || physical.is_empty() {
        return Vec::new();
    }
    let blocks = physical.len() / physical_block;
    let mut out = Vec::with_capacity(blocks.saturating_mul(block_size.min(bytes_per_channel)) * ch);
    for block in 0..blocks {
        let base = block * physical_block;
        let channel_bytes = block_size.min(bytes_per_channel.saturating_sub(consumed_per_channel));
        for byte_index in 0..channel_bytes {
            for channel in 0..ch {
                out.push(physical[base + channel * block_size + byte_index]);
            }
        }
        consumed_per_channel = consumed_per_channel.saturating_add(block_size);
    }
    out
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().unwrap_or([0; 4]))
}
fn le_u64(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().unwrap_or([0; 8]))
}

fn parse_dsf(bytes: &[u8], _file_len: u64) -> CoreResult<DsdFormat> {
    if bytes.len() < 92 {
        return Err(CoreError::Unsupported("DSF header is truncated".into()));
    }
    if le_u64(&bytes[4..12]) != 28 {
        return Err(CoreError::Unsupported(
            "DSD header size must be 28 bytes".into(),
        ));
    }
    let channels = le_u32(&bytes[52..56]) as u16;
    let dsd_sample_rate = le_u32(&bytes[56..60]);
    let bits_per_sample = le_u32(&bytes[60..64]);
    let sample_count = le_u64(&bytes[64..72]);
    let block_size = le_u32(&bytes[72..76]);
    if channels == 0 || (bits_per_sample != 1 && bits_per_sample != 8) || block_size == 0 {
        return Err(CoreError::Unsupported("invalid DSF fmt".into()));
    }
    if &bytes[80..84] != b"data" {
        return Err(CoreError::Unsupported("DSF data chunk missing".into()));
    }
    let data_chunk_size = le_u64(&bytes[84..92]);
    let dsd_rate = dsd_rate_from_sample_rate(dsd_sample_rate)
        .ok_or_else(|| CoreError::Unsupported(format!("unsupported DSD rate {dsd_sample_rate}")))?;
    Ok(DsdFormat {
        container: DsdContainer::Dsf,
        encoding: DsdEncoding::Raw,
        dsd_sample_rate,
        dsd_rate,
        channels,
        sample_count,
        duration_ms: sample_count.saturating_mul(1000) / u64::from(dsd_sample_rate.max(1)),
        data_offset: 92,
        data_size: data_chunk_size.saturating_sub(12),
        block_size,
        lsb_first: bits_per_sample == 1,
        dst_status: DstStatus::None,
    })
}

fn scan_frte(
    bytes: &[u8],
    start: usize,
    end: usize,
    frame_count: &mut Option<u32>,
    frame_rate: &mut Option<u32>,
) {
    let mut offset = start;
    while offset + 12 <= bytes.len() && offset + 12 <= end {
        let id = &bytes[offset..offset + 4];
        let size = u64::from_be_bytes(bytes[offset + 4..offset + 12].try_into().unwrap_or([0; 8]));
        let payload = offset + 12;
        if id == b"FRTE" && payload + 6 <= bytes.len() && payload + 6 <= end {
            *frame_count = Some(u32::from_be_bytes(
                bytes[payload..payload + 4].try_into().unwrap_or([0; 4]),
            ));
            *frame_rate = Some(u16::from_be_bytes(
                bytes[payload + 4..payload + 6].try_into().unwrap_or([0; 2]),
            ) as u32);
        }
        offset = payload
            .saturating_add(size as usize)
            .saturating_add((size % 2) as usize);
    }
}

fn parse_dff(bytes: &[u8]) -> CoreResult<DsdFormat> {
    if bytes.len() < 16 || &bytes[12..16] != b"DSD " {
        return Err(CoreError::Unsupported("FRM8 is not a DSD form".into()));
    }
    let mut offset = 16usize;
    let mut encoding = DsdEncoding::Raw;
    let mut channels = 2u16;
    let mut dsd_sample_rate = 2_822_400u32;
    let mut data_offset = 0u64;
    let mut data_size = 0u64;
    let mut dst_frame_count = None;
    let mut dst_frame_rate = None;
    while offset + 12 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u64::from_be_bytes(bytes[offset + 4..offset + 12].try_into().unwrap_or([0; 8]));
        let payload = offset + 12;
        if id == b"PROP" && payload + 4 <= bytes.len() {
            let mut inner = payload + 4;
            let prop_end = payload.saturating_add(size as usize);
            while inner + 12 <= bytes.len() && inner + 12 <= prop_end {
                let cid = &bytes[inner..inner + 4];
                let csize =
                    u64::from_be_bytes(bytes[inner + 4..inner + 12].try_into().unwrap_or([0; 8]));
                let cpay = inner + 12;
                if cid == b"FS  " && cpay + 4 <= bytes.len() {
                    dsd_sample_rate =
                        u32::from_be_bytes(bytes[cpay..cpay + 4].try_into().unwrap_or([0; 4]));
                }
                if cid == b"CHNL" && cpay + 2 <= bytes.len() {
                    channels =
                        u16::from_be_bytes(bytes[cpay..cpay + 2].try_into().unwrap_or([0; 2]));
                }
                if cid == b"CMPR" && cpay + 4 <= bytes.len() && &bytes[cpay..cpay + 4] == b"DST " {
                    encoding = DsdEncoding::Dst;
                }
                inner = inner
                    .saturating_add(12)
                    .saturating_add(csize as usize)
                    .saturating_add((csize % 2) as usize);
            }
        }
        if id == b"CMPR" && payload + 4 <= bytes.len() && &bytes[payload..payload + 4] == b"DST " {
            encoding = DsdEncoding::Dst;
        }
        if id == b"FRTE" && payload + 6 <= bytes.len() {
            dst_frame_count = Some(u32::from_be_bytes(
                bytes[payload..payload + 4].try_into().unwrap_or([0; 4]),
            ));
            dst_frame_rate = Some(u16::from_be_bytes(
                bytes[payload + 4..payload + 6].try_into().unwrap_or([0; 2]),
            ) as u32);
        }
        if id == b"DSD " || id == b"DST " {
            data_offset = payload as u64;
            data_size = size;
            if id == b"DST " {
                encoding = DsdEncoding::Dst;
                let end = payload.saturating_add(size as usize);
                scan_frte(
                    bytes,
                    payload,
                    end,
                    &mut dst_frame_count,
                    &mut dst_frame_rate,
                );
            }
            break;
        }
        offset = offset
            .saturating_add(12)
            .saturating_add(size as usize)
            .saturating_add((size % 2) as usize);
    }
    if data_offset == 0 {
        return Err(CoreError::Unsupported(
            "DFF data chunk was not found".into(),
        ));
    }
    let dsd_rate = dsd_rate_from_sample_rate(dsd_sample_rate)
        .ok_or_else(|| CoreError::Unsupported(format!("unsupported DSD rate {dsd_sample_rate}")))?;
    let sample_count = if encoding == DsdEncoding::Dst {
        match (dst_frame_count, dst_frame_rate) {
            (Some(frames), Some(rate)) if rate > 0 => {
                u64::from(frames) * u64::from(dsd_sample_rate) / u64::from(rate)
            }
            _ => data_size.saturating_mul(8) / u64::from(channels.max(1)),
        }
    } else {
        data_size.saturating_mul(8) / u64::from(channels.max(1))
    };
    Ok(DsdFormat {
        container: DsdContainer::Dff,
        encoding,
        dsd_sample_rate,
        dsd_rate,
        channels: channels.max(1),
        sample_count,
        duration_ms: sample_count.saturating_mul(1000) / u64::from(dsd_sample_rate.max(1)),
        data_offset,
        data_size,
        block_size: 4096,
        lsb_first: false,
        dst_status: DsdFormat::dst_status_for_rate(dsd_rate, encoding),
    })
}

pub struct ParsedDsdSource {
    source: MediaSource,
    format: DsdFormat,
    position: u64,
    timestamp_ms: u64,
    pending: Vec<u8>,
    dst_decoder: Option<DstSession>,
}

struct DstSession {
    #[cfg(feature = "dst-rust")]
    decoder: dst_decoder::decoder::DstDecoder,
    #[cfg(not(feature = "dst-rust"))]
    _dummy: (),
}

impl ParsedDsdSource {
    pub fn open(mut source: MediaSource) -> CoreResult<Self> {
        let mut head = vec![0u8; 256 * 1024];
        let n = source.read(&mut head)?;
        head.truncate(n);
        let format = parse_header(&head, source.len())?;
        source.seek(SeekFrom::Start(format.data_offset))?;
        let dst_decoder = if format.encoding == DsdEncoding::Dst {
            Some(DstSession::new(format.channels, format.dsd_sample_rate)?)
        } else {
            None
        };
        Ok(Self {
            source,
            format,
            position: 0,
            timestamp_ms: 0,
            pending: Vec::new(),
            dst_decoder,
        })
    }

    fn emit_block(&mut self, bytes: Vec<u8>) -> DsdBlock {
        let timestamp_ms = self.timestamp_ms;
        let bits = (bytes.len() as u64) * 8 / u64::from(self.format.channels.max(1));
        self.timestamp_ms +=
            bits.saturating_mul(1000) / u64::from(self.format.dsd_sample_rate.max(1));
        DsdBlock {
            bytes,
            channels: self.format.channels,
            dsd_rate: self.format.dsd_rate,
            lsb_first: self.format.lsb_first,
            timestamp_ms,
            dst: self.format.dst_status,
        }
    }

    fn next_dsf_block(&mut self, max_bytes: usize) -> CoreResult<Option<DsdBlock>> {
        let ch = usize::from(self.format.channels.max(1));
        let block_size = self.format.block_size.max(1) as usize;
        let physical_block = block_size.saturating_mul(ch);
        if physical_block == 0 {
            return Ok(None);
        }
        let want_blocks = max_bytes
            .max(physical_block)
            .div_ceil(physical_block)
            .max(1);
        let want_physical = want_blocks.saturating_mul(physical_block);

        while self.pending.len() < want_physical && self.position < self.format.data_size {
            let remaining = (self.format.data_size - self.position) as usize;
            let need = (want_physical - self.pending.len()).min(remaining);
            if need == 0 {
                break;
            }
            let mut buf = vec![0u8; need];
            let n = self.source.read(&mut buf)?;
            if n == 0 {
                break;
            }
            buf.truncate(n);
            self.pending.extend_from_slice(&buf);
            self.position += n as u64;
        }

        let take_blocks = (self.pending.len() / physical_block).min(want_blocks);
        if take_blocks == 0 {
            self.pending.clear();
            return Ok(None);
        }
        let take = take_blocks * physical_block;
        let leftover = self.pending.len() - take;
        let consumed_physical = self
            .position
            .saturating_sub(leftover as u64)
            .saturating_sub(take as u64);
        let consumed_per_channel =
            (consumed_physical / physical_block as u64) as usize * block_size;
        let physical: Vec<u8> = self.pending.drain(..take).collect();
        let bytes = deinterleave_dsf_planar(
            &physical,
            self.format.channels,
            self.format.block_size,
            consumed_per_channel,
            self.format.bytes_per_channel() as usize,
        );
        if bytes.is_empty() {
            return Ok(None);
        }
        Ok(Some(self.emit_block(bytes)))
    }
}

impl DstSession {
    fn new(channels: u16, sample_rate: u32) -> CoreResult<Self> {
        #[cfg(feature = "dst-rust")]
        {
            let decoder = dst_decoder::decoder::DstDecoder::new(
                usize::from(channels.max(1)),
                sample_rate as usize,
            )
            .map_err(|e| CoreError::Decode(format!("DST decoder init: {e}")))?;
            Ok(Self { decoder })
        }
        #[cfg(not(feature = "dst-rust"))]
        {
            let _ = (channels, sample_rate);
            Err(CoreError::Unsupported(
                "DST requires the dst-rust feature".into(),
            ))
        }
    }
}

impl DsdSource for ParsedDsdSource {
    fn info(&self) -> &DsdFormat {
        &self.format
    }

    fn next_block(&mut self, max_bytes: usize) -> CoreResult<Option<DsdBlock>> {
        if self.format.container == DsdContainer::Dsf && self.format.encoding == DsdEncoding::Raw {
            return self.next_dsf_block(max_bytes);
        }
        if self.position >= self.format.data_size {
            return Ok(None);
        }
        let remaining = (self.format.data_size - self.position) as usize;
        let want = max_bytes
            .max(self.format.block_size as usize)
            .min(remaining);
        let mut buf = vec![0u8; want];
        let n = self.source.read(&mut buf)?;
        if n == 0 {
            return Ok(None);
        }
        buf.truncate(n);
        self.position += n as u64;
        let mut bytes = buf;
        if let Some(session) = self.dst_decoder.as_mut() {
            bytes = decode_dst(session, &bytes, &self.format)?;
        }
        Ok(Some(self.emit_block(bytes)))
    }

    fn seek_ms(&mut self, target_ms: u64) -> CoreResult<u64> {
        let clamped = target_ms.min(self.format.duration_ms);
        self.pending.clear();
        let aligned = if self.format.container == DsdContainer::Dsf {
            let block_size = u64::from(self.format.block_size.max(1));
            let byte = (clamped.saturating_mul(u64::from(self.format.dsd_sample_rate)) / 1000 / 8)
                .min(self.format.bytes_per_channel());
            let block = byte / block_size;
            block
                .saturating_mul(block_size)
                .saturating_mul(u64::from(self.format.channels.max(1)))
        } else {
            let frac = clamped as f64 / self.format.duration_ms.max(1) as f64;
            let offset = (frac * self.format.data_size as f64) as u64;
            let step = u64::from(self.format.channels.max(1));
            offset - (offset % step)
        };
        self.source
            .seek(SeekFrom::Start(self.format.data_offset + aligned))?;
        self.position = aligned;
        self.timestamp_ms = if self.format.container == DsdContainer::Dsf {
            let physical_block = self.format.physical_block_bytes().max(1);
            let consumed =
                (aligned / physical_block).saturating_mul(u64::from(self.format.block_size.max(1)));
            consumed.saturating_mul(8).saturating_mul(1000)
                / u64::from(self.format.dsd_sample_rate.max(1))
        } else {
            clamped
        };
        Ok(self.timestamp_ms)
    }

    fn flush(&mut self) {
        self.pending.clear();
    }
}

fn decode_dst(session: &mut DstSession, frame: &[u8], format: &DsdFormat) -> CoreResult<Vec<u8>> {
    match format.dst_status {
        DstStatus::Unsupported => Err(CoreError::Unsupported("DST512 is not supported".into())),
        DstStatus::None => Ok(frame.to_vec()),
        DstStatus::Stable | DstStatus::Experimental => {
            #[cfg(feature = "dst-rust")]
            {
                let mut decoded = vec![0u8; session.decoder.dsd_frame_bytes().max(1)];
                let written = session
                    .decoder
                    .decode_frame(frame, &mut decoded)
                    .map_err(|e| CoreError::Decode(format!("DST decode: {e}")))?;
                decoded.truncate(written);
                Ok(decoded)
            }
            #[cfg(not(feature = "dst-rust"))]
            {
                let _ = session;
                Err(CoreError::Unsupported("DST decoder not compiled".into()))
            }
        }
    }
}

pub fn create_minimal_dsf() -> Vec<u8> {
    let channels = 2u32;
    let block_size = 8u32;
    let sample_count = 64u64;
    let data_size = 16u64;
    let mut body = vec![0u8; 92 + data_size as usize];
    let file_len = (body.len() as u64).to_le_bytes();
    body[0..4].copy_from_slice(b"DSD ");
    body[4..12].copy_from_slice(&28u64.to_le_bytes());
    body[12..20].copy_from_slice(&file_len);
    body[28..32].copy_from_slice(b"fmt ");
    body[32..40].copy_from_slice(&52u64.to_le_bytes());
    body[40..44].copy_from_slice(&1u32.to_le_bytes());
    body[48..52].copy_from_slice(&2u32.to_le_bytes());
    body[52..56].copy_from_slice(&channels.to_le_bytes());
    body[56..60].copy_from_slice(&2_822_400u32.to_le_bytes());
    body[60..64].copy_from_slice(&8u32.to_le_bytes());
    body[64..72].copy_from_slice(&sample_count.to_le_bytes());
    body[72..76].copy_from_slice(&block_size.to_le_bytes());
    body[80..84].copy_from_slice(b"data");
    body[84..92].copy_from_slice(&(data_size + 12).to_le_bytes());
    body[92..].fill(0x69);
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dsf_and_reads_blocks() {
        let bytes = create_minimal_dsf();
        let source = MediaSource::from_bytes("test.dsf", bytes);
        let mut dsd = ParsedDsdSource::open(source).unwrap();
        assert_eq!(dsd.info().dsd_rate, DsdRate::Dsd64);
        let block = dsd.next_block(4096).unwrap().unwrap();
        assert_eq!(block.channels, 2);
        assert!(!block.lsb_first);
    }

    #[test]
    fn deinterleave_dsf_planar_matches_ndsd_byte_order() {
        let physical = [
            0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25,
            0x26, 0x27,
        ];
        assert_eq!(
            deinterleave_dsf_planar(&physical, 2, 8, 0, 8),
            vec![
                0x10, 0x20, 0x11, 0x21, 0x12, 0x22, 0x13, 0x23, 0x14, 0x24, 0x15, 0x25, 0x16, 0x26,
                0x17, 0x27,
            ]
        );
    }

    #[test]
    fn deinterleave_dsf_planar_drops_block_padding() {
        let mut physical = vec![0u8; 16];
        physical[..8].copy_from_slice(&[1, 2, 3, 4, 0, 0, 0, 0]);
        physical[8..].copy_from_slice(&[5, 6, 7, 8, 0, 0, 0, 0]);
        assert_eq!(
            deinterleave_dsf_planar(&physical, 2, 8, 0, 4),
            vec![1, 5, 2, 6, 3, 7, 4, 8]
        );
    }

    #[test]
    fn parsed_dsf_source_emits_byte_interleaved_blocks() {
        let mut bytes = create_minimal_dsf();
        bytes[92..100].copy_from_slice(&[0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
        bytes[100..108].copy_from_slice(&[0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]);
        let source = MediaSource::from_bytes("ordered.dsf", bytes);
        let mut dsd = ParsedDsdSource::open(source).unwrap();
        // Half a physical block would previously leak the left plane only.
        let block = dsd.next_block(8).unwrap().unwrap();
        assert_eq!(
            block.bytes,
            vec![
                0x10, 0x20, 0x11, 0x21, 0x12, 0x22, 0x13, 0x23, 0x14, 0x24, 0x15, 0x25, 0x16, 0x26,
                0x17, 0x27,
            ]
        );
        assert!(dsd.next_block(8).unwrap().is_none());
        assert_eq!(dsd.seek_ms(0).unwrap(), 0);
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

    fn create_dst_dff_with_frte(frame_count: u32, frame_rate: u16) -> Vec<u8> {
        let mut prop = b"SND ".to_vec();
        prop.extend(dff_chunk(b"FS  ", &2_822_400u32.to_be_bytes()));
        prop.extend(dff_chunk(b"CHNL", &[0, 2]));
        prop.extend(dff_chunk(b"CMPR", b"DST "));
        let mut dst = Vec::new();
        let mut frte = Vec::new();
        frte.extend_from_slice(&frame_count.to_be_bytes());
        frte.extend_from_slice(&frame_rate.to_be_bytes());
        dst.extend(dff_chunk(b"FRTE", &frte));
        dst.extend(dff_chunk(b"DSTF", &[0, 0, 0, 0]));
        let mut inner = dff_chunk(b"PROP", &prop);
        inner.extend(dff_chunk(b"DST ", &dst));
        let mut file = b"FRM8".to_vec();
        file.extend_from_slice(&(4u64 + inner.len() as u64).to_be_bytes());
        file.extend_from_slice(b"DSD ");
        file.extend(inner);
        file
    }

    #[test]
    fn dff_dst_duration_uses_frte_not_compressed_size() {
        let bytes = create_dst_dff_with_frte(1, 75);
        let format = parse_header(&bytes, bytes.len() as u64).unwrap();
        assert_eq!(format.encoding, DsdEncoding::Dst);
        assert_eq!(format.sample_count, 2_822_400 / 75);
        assert_eq!(format.duration_ms, 13);
    }

    #[test]
    fn dsf_header_parse_does_not_need_the_payload() {
        let bytes = create_minimal_dsf();
        let format = parse_header(&bytes[..92], bytes.len() as u64).unwrap();
        assert_eq!(format.dsd_rate, DsdRate::Dsd64);
        assert_eq!(format.sample_count, 64);
    }
}

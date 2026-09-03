use std::cell::Cell;
use std::io::{Read, Seek, SeekFrom};
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::decimator::{dsd_bytes_to_pcm_f64, dsd_pcm_output_rate_hz, DsdDecimator};
use crate::decoder::PcmDecoder;
use crate::dsd::{parse_header, DsdEncoding, DsdSource, ParsedDsdSource};
use crate::probe::AudioProbe;
use crate::source::MediaSource;
use crate::types::dsd_rate_from_sample_rate;

#[wasm_bindgen]
pub struct DecodedPcm {
    samples: Vec<f32>,
    channels: u16,
    sample_rate: u32,
}

/// JS host: `{ size: number, readSync(offset, length): Uint8Array | { needOffset, needLength } }`.
/// `readSync` must not fetch. Misses return a need object so JS can Range-fill a window and retry.
struct JsMediaSource {
    host: JsValue,
    pos: Rc<Cell<u64>>,
    len: u64,
    need: Rc<Cell<Option<(u64, u32)>>>,
}

// WASM is single-threaded; Symphonia's MediaSource requires Send + Sync.
unsafe impl Send for JsMediaSource {}
unsafe impl Sync for JsMediaSource {}

impl JsMediaSource {
    fn new(host: JsValue) -> Result<Self, JsValue> {
        let len = host_size(&host)?;
        Ok(Self {
            host,
            pos: Rc::new(Cell::new(0)),
            len,
            need: Rc::new(Cell::new(None)),
        })
    }
}

impl Read for JsMediaSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if buf.is_empty() || self.pos.get() >= self.len {
            return Ok(0);
        }
        let want = (buf.len() as u64)
            .min(self.len.saturating_sub(self.pos.get()))
            .min(u32::MAX as u64) as u32;
        let value = host_read_sync(&self.host, self.pos.get(), want).map_err(js_to_io)?;
        if let Some((offset, length)) = parse_need_js(&value) {
            self.need.set(Some((offset, length)));
            return Err(need_bytes_error(offset, length));
        }
        let Some(arr) = value.dyn_ref::<js_sys::Uint8Array>() else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "readSync must return Uint8Array or a need object",
            ));
        };
        let n = (arr.length() as usize).min(buf.len());
        if n == 0 {
            return Ok(0);
        }
        arr.slice(0, n as u32).copy_to(&mut buf[..n]);
        self.pos.set(self.pos.get() + n as u64);
        Ok(n)
    }
}

impl Seek for JsMediaSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let next = match pos {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(n) => self.pos.get() as i128 + i128::from(n),
            SeekFrom::End(n) => self.len as i128 + i128::from(n),
        };
        if next < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "seek before start of range source",
            ));
        }
        self.pos.set(next as u64);
        Ok(self.pos.get())
    }
}

impl symphonia::core::io::MediaSource for JsMediaSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.len)
    }
}

#[wasm_bindgen]
pub struct StreamingDecoder {
    decoder: PcmDecoder,
    position_frames: u64,
    pending: Vec<f32>,
    byte_pos: Rc<Cell<u64>>,
    need: Rc<Cell<Option<(u64, u32)>>>,
}

#[wasm_bindgen]
impl StreamingDecoder {
    #[wasm_bindgen(getter)]
    pub fn channels(&self) -> u16 {
        self.decoder.channels()
    }

    #[wasm_bindgen(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.decoder.sample_rate()
    }

    #[wasm_bindgen(getter)]
    pub fn duration_ms(&self) -> u64 {
        self.decoder.duration_ms()
    }

    #[wasm_bindgen(getter, js_name = bytePosition)]
    pub fn byte_position(&self) -> f64 {
        self.byte_pos.get() as f64
    }

    pub fn decode_chunk(&mut self, max_frames: usize) -> Result<Vec<f32>, JsValue> {
        let channels = self.decoder.channels() as usize;
        let limit = max_frames.max(1).saturating_mul(channels);
        let mut out = Vec::with_capacity(limit);
        if !self.pending.is_empty() {
            let take = limit.min(self.pending.len());
            out.extend_from_slice(&self.pending[..take]);
            self.pending.drain(..take);
        }
        while out.len() < limit {
            let need = Rc::clone(&self.need);
            match self.decoder.decode_next().map_err(|e| map_need_or_err(&e, &need))? {
                Some(chunk) => {
                    let take = (limit - out.len()).min(chunk.len());
                    out.extend_from_slice(&chunk[..take]);
                    self.position_frames += (take / channels) as u64;
                    if take < chunk.len() {
                        self.pending.extend_from_slice(&chunk[take..]);
                        break;
                    }
                }
                None => break,
            }
        }
        Ok(out)
    }

    pub fn seek_ms(&mut self, target_ms: u64) -> Result<(), JsValue> {
        let need = Rc::clone(&self.need);
        self.decoder.seek(target_ms).map_err(|e| map_need_or_err(&e, &need))?;
        self.position_frames = target_ms.saturating_mul(self.sample_rate() as u64) / 1000;
        self.pending.clear();
        Ok(())
    }
}

/// Random-access streaming open. Does not take a contiguous file buffer.
#[wasm_bindgen(js_name = openStreamingSource)]
pub fn open_streaming_source(host: JsValue, hint_ext: String) -> Result<StreamingDecoder, JsValue> {
    let source = JsMediaSource::new(host)?;
    let byte_pos = Rc::clone(&source.pos);
    let need = Rc::clone(&source.need);
    let mut hint = symphonia::core::probe::Hint::new();
    let ext = hint_ext.trim().trim_start_matches('.');
    if !ext.is_empty() {
        hint.with_extension(ext);
    }
    let decoder = PcmDecoder::open_boxed(Box::new(source), "wasm-range", hint)
        .map_err(|e| map_need_or_err(&e, &need))?;
    Ok(StreamingDecoder {
        decoder,
        position_frames: 0,
        pending: Vec::new(),
        byte_pos,
        need,
    })
}

/// Test helper: wrap in-memory bytes in the same Read+Seek host path (still not a `&[u8]` decode).
#[wasm_bindgen]
pub fn open_streaming(bytes: &[u8]) -> Result<StreamingDecoder, JsValue> {
    if bytes.len() >= 4 && (&bytes[..4] == b"DSD " || &bytes[..4] == b"FRM8") {
        return Err(JsValue::from_str("streaming DSD decoder is not available"));
    }
    let source = MediaSource::from_bytes("wasm", bytes.to_vec());
    let decoder = PcmDecoder::open(source).map_err(js_err)?;
    Ok(StreamingDecoder {
        decoder,
        position_frames: 0,
        pending: Vec::new(),
        byte_pos: Rc::new(Cell::new(0)),
        need: Rc::new(Cell::new(None)),
    })
}

fn host_size(host: &JsValue) -> Result<u64, JsValue> {
    let value = js_sys::Reflect::get(host, &JsValue::from_str("size"))?;
    let size = value
        .as_f64()
        .ok_or_else(|| JsValue::from_str("range host is missing numeric size"))?;
    if !(size.is_finite() && size >= 0.0) {
        return Err(JsValue::from_str("range host size is invalid"));
    }
    Ok(size as u64)
}

fn host_read_sync(host: &JsValue, offset: u64, length: u32) -> Result<JsValue, JsValue> {
    let f = js_sys::Reflect::get(host, &JsValue::from_str("readSync"))?;
    let f = js_sys::Function::from(f);
    f.call2(
        host,
        &JsValue::from(offset as f64),
        &JsValue::from(length),
    )
}

fn parse_need_js(value: &JsValue) -> Option<(u64, u32)> {
    let offset = js_sys::Reflect::get(value, &JsValue::from_str("needOffset"))
        .ok()
        .and_then(|v| v.as_f64())?;
    if !offset.is_finite() || offset < 0.0 {
        return None;
    }
    let length = js_sys::Reflect::get(value, &JsValue::from_str("needLength"))
        .ok()
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(1.0);
    Some((offset as u64, length.min(u32::MAX as f64) as u32))
}

fn parse_need_str(text: &str) -> Option<(u64, u32)> {
    let marker = "NNPM_NEED_BYTES:";
    let rest = text.split(marker).nth(1)?;
    let mut parts = rest.split(':');
    let offset: u64 = parts.next()?.trim().parse().ok()?;
    let length: u32 = parts
        .next()?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;
    Some((offset, length.max(1)))
}

fn need_bytes_error(offset: u64, length: u32) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::Interrupted,
        format!("NNPM_NEED_BYTES:{offset}:{length}"),
    )
}

fn need_js(offset: u64, length: u32) -> JsValue {
    let obj = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("needOffset"), &JsValue::from(offset as f64));
    let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("needLength"), &JsValue::from(length));
    obj.into()
}

fn map_need_or_err(err: &crate::error::CoreError, need: &Rc<Cell<Option<(u64, u32)>>>) -> JsValue {
    if let Some((offset, length)) = need.take() {
        return need_js(offset, length);
    }
    if let Some((offset, length)) = parse_need_str(&err.to_string()) {
        return need_js(offset, length);
    }
    js_err(err)
}

fn js_to_io(err: JsValue) -> std::io::Error {
    let msg = err.as_string().or_else(|| {
        js_sys::Reflect::get(&err, &JsValue::from_str("message"))
            .ok()
            .and_then(|value| value.as_string())
    }).unwrap_or_else(|| "range host readSync failed".into());
    if let Some((offset, length)) = parse_need_str(&msg) {
        return need_bytes_error(offset, length);
    }
    std::io::Error::new(std::io::ErrorKind::Other, msg)
}

#[wasm_bindgen]
impl DecodedPcm {
    #[wasm_bindgen(getter)]
    pub fn channels(&self) -> u16 {
        self.channels
    }

    #[wasm_bindgen(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[wasm_bindgen(getter)]
    pub fn samples(&self) -> Vec<f32> {
        self.samples.clone()
    }
}

#[wasm_bindgen]
pub fn probe_bytes(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let mut source = MediaSource::from_bytes("wasm", bytes.to_vec());
    let report = AudioProbe::inspect(&mut source).map_err(js_err)?;
    serde_wasm_bindgen_compat(&report)
}

#[wasm_bindgen]
pub fn parse_dsd_header_json(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let format = parse_header(bytes, bytes.len() as u64).map_err(js_err)?;
    let encoding = match format.encoding {
        DsdEncoding::Raw => "raw",
        DsdEncoding::Dst => "dst",
    };
    let container = match format.container {
        crate::dsd::DsdContainer::Dsf => "dsf",
        crate::dsd::DsdContainer::Dff => "dff",
    };
    let value = serde_json::json!({
        "container": container,
        "encoding": encoding,
        "dsdSampleRate": format.dsd_sample_rate,
        "pcmSampleRate": format.dsd_sample_rate / 8,
        "outputSampleRate": dsd_pcm_output_rate_hz(format.dsd_sample_rate),
        "dsdRate": format.dsd_rate.multiplier(),
        "channels": format.channels,
        "sampleCount": format.sample_count,
        "durationMs": format.duration_ms,
        "dataOffset": format.data_offset,
        "dataSize": format.data_size,
        "blockSize": format.block_size,
        "lsbFirst": format.lsb_first,
        "dstStatus": format.dst_status,
    });
    serde_wasm_bindgen_compat(&value)
}

#[wasm_bindgen]
pub fn decode_audio(bytes: &[u8]) -> Result<DecodedPcm, JsValue> {
    if bytes.len() >= 4 && (&bytes[..4] == b"DSD " || &bytes[..4] == b"FRM8") {
        return decode_dsd(bytes);
    }
    let source = MediaSource::from_bytes("wasm", bytes.to_vec());
    let mut decoder = PcmDecoder::open(source).map_err(js_err)?;
    let channels = decoder.channels();
    let sample_rate = decoder.sample_rate();
    let samples = decoder.decode_all_f32().map_err(js_err)?;
    Ok(DecodedPcm {
        samples,
        channels,
        sample_rate,
    })
}

#[wasm_bindgen]
pub fn decode_pcm_f32(bytes: &[u8]) -> Result<Vec<f32>, JsValue> {
    Ok(decode_audio(bytes)?.samples)
}

#[wasm_bindgen]
pub fn decode_dsd_f32(bytes: &[u8]) -> Result<Vec<f32>, JsValue> {
    Ok(decode_dsd(bytes)?.samples)
}

fn decode_dsd(bytes: &[u8]) -> Result<DecodedPcm, JsValue> {
    let format = parse_header(bytes, bytes.len() as u64).map_err(js_err)?;
    if matches!(format.dst_status, crate::dsd::DstStatus::Unsupported) {
        return Err(js_err(crate::error::CoreError::Unsupported(
            "DST at this DSD rate is not supported".into(),
        )));
    }
    let source = MediaSource::from_bytes("wasm.dsf", bytes.to_vec());
    let mut dsd = ParsedDsdSource::open(source).map_err(js_err)?;
    let mut raw = Vec::new();
    while let Some(block) = dsd.next_block(64 * 1024).map_err(js_err)? {
        raw.extend_from_slice(&block.bytes);
    }
    let target = dsd_pcm_output_rate_hz(format.dsd_sample_rate);
    let pcm = dsd_bytes_to_pcm_f64(
        &raw,
        format.channels,
        format.lsb_first,
        format.dsd_sample_rate,
        target,
    );
    Ok(DecodedPcm {
        samples: pcm.into_iter().map(|s| s as f32).collect(),
        channels: format.channels,
        sample_rate: target,
    })
}

/// Decode a raw DSD payload (no container header) with the core FIR graph.
#[wasm_bindgen]
pub fn dsd_payload_to_pcm_f32(
    bytes: &[u8],
    channels: u16,
    lsb_first: bool,
    dsd_sample_rate: u32,
) -> Result<Vec<f32>, JsValue> {
    dsd_rate_from_sample_rate(dsd_sample_rate)
        .ok_or_else(|| JsValue::from_str("unsupported DSD sample rate"))?;
    let target = dsd_pcm_output_rate_hz(dsd_sample_rate);
    let pcm = dsd_bytes_to_pcm_f64(bytes, channels, lsb_first, dsd_sample_rate, target);
    Ok(pcm.into_iter().map(|s| s as f32).collect())
}

/// Streaming DSD → PCM so range-fetched chunks share FIR look-ahead.
#[wasm_bindgen]
pub struct DsdPcmStream {
    decimator: DsdDecimator,
}

#[wasm_bindgen]
impl DsdPcmStream {
    #[wasm_bindgen(constructor)]
    pub fn new(
        channels: u16,
        lsb_first: bool,
        dsd_sample_rate: u32,
    ) -> Result<DsdPcmStream, JsValue> {
        dsd_rate_from_sample_rate(dsd_sample_rate)
            .ok_or_else(|| JsValue::from_str("unsupported DSD sample rate"))?;
        let target = dsd_pcm_output_rate_hz(dsd_sample_rate);
        let decimator = DsdDecimator::new(channels, lsb_first, dsd_sample_rate, target)
            .ok_or_else(|| JsValue::from_str("invalid DSD stream parameters"))?;
        Ok(Self { decimator })
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<f32> {
        self.decimator
            .push(bytes)
            .into_iter()
            .map(|s| s as f32)
            .collect()
    }

    pub fn flush(&mut self) -> Vec<f32> {
        self.decimator
            .flush()
            .into_iter()
            .map(|s| s as f32)
            .collect()
    }
}

fn js_err(err: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&err.to_string())
}

fn serde_wasm_bindgen_compat<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let json = serde_json::to_string(value).map_err(js_err)?;
    js_sys::JSON::parse(&json).map_err(|e| e)
}

//! I/O-agnostic DSF/DFF header parse and compact DSD→PCM conversion.
//! Implementation lives in `nnpm-audio-core`; this crate re-exports it for WASM/web.

pub use nnpm_audio_core::decimator::{
    dsd_bytes_to_pcm_f64, dsd_pcm_output_rate, dsd_pcm_output_rate_hz,
};
pub use nnpm_audio_core::dsd::{parse_header, DsdContainer, DsdEncoding};
pub use nnpm_audio_core::error::CoreError as DsdError;
pub use nnpm_audio_core::types::dsd_rate_from_sample_rate;

use nnpm_audio_core::dsd::DsdFormat as CoreFormat;

pub type DsdResult<T> = Result<T, DsdError>;

pub struct DsdInfo {
    pub container: DsdContainer,
    pub encoding: DsdEncoding,
    pub dsd_sample_rate: u32,
    pub pcm_sample_rate: u32,
    pub output_sample_rate: u32,
    pub dsd_rate: u32,
    pub channels: u16,
    pub sample_count: u64,
    pub duration_ms: u64,
    pub data_offset: u64,
    pub data_size: u64,
    pub block_size: u32,
    pub lsb_first: bool,
}

impl From<CoreFormat> for DsdInfo {
    fn from(format: CoreFormat) -> Self {
        Self {
            container: format.container,
            encoding: format.encoding,
            dsd_sample_rate: format.dsd_sample_rate,
            pcm_sample_rate: format.dsd_sample_rate / 8,
            output_sample_rate: dsd_pcm_output_rate_hz(format.dsd_sample_rate),
            dsd_rate: format.dsd_rate.multiplier(),
            channels: format.channels,
            sample_count: format.sample_count,
            duration_ms: format.duration_ms,
            data_offset: format.data_offset,
            data_size: format.data_size,
            block_size: format.block_size,
            lsb_first: format.lsb_first,
        }
    }
}

pub fn parse_header_info(bytes: &[u8], file_len: u64) -> DsdResult<DsdInfo> {
    parse_header(bytes, file_len).map(DsdInfo::from)
}

pub fn dsd_bytes_to_pcm(bytes: &[u8], channels: u16, lsb_first: bool) -> Vec<f32> {
    dsd_bytes_to_pcm_f64(bytes, channels, lsb_first, 2_822_400, 176_400)
        .into_iter()
        .map(|s| s as f32)
        .collect()
}

pub fn create_minimal_dsf() -> Vec<u8> {
    nnpm_audio_core::dsd::create_minimal_dsf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dsf_and_rejects_missing_signature() {
        let bytes = create_minimal_dsf();
        let info = parse_header_info(&bytes, bytes.len() as u64).expect("dsf");
        assert_eq!(info.dsd_rate, 64);
        assert_eq!(info.output_sample_rate, 176_400);
        assert!(parse_header(b"xxxx", 4).is_err());
    }
}

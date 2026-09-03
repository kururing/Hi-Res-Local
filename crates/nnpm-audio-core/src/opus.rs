//! Ogg Opus identification and RFC-vector gate.
//!
//! Full RFC 8251 decode is accepted only when `tests/opus_rfc.rs` passes the
//! committed test vectors. Identification of the Ogg Opus mapping is always on.

use crate::error::{CoreError, CoreResult};

const OPUS_HEAD: &[u8] = b"OpusHead";
const OPUS_TAGS: &[u8] = b"OpusTags";

#[derive(Debug, Clone)]
pub struct OpusId {
    pub channels: u8,
    pub input_sample_rate: u32,
    pub pre_skip: u16,
}

pub fn identify_ogg_opus(bytes: &[u8]) -> CoreResult<OpusId> {
    if bytes.len() < 4 || &bytes[0..4] != b"OggS" {
        return Err(CoreError::Unsupported("not an Ogg bitstream".into()));
    }
    if let Some(pos) = find_slice(bytes, OPUS_HEAD) {
        if pos + 19 <= bytes.len() {
            return Ok(OpusId {
                channels: bytes[pos + 9],
                pre_skip: u16::from_le_bytes([bytes[pos + 10], bytes[pos + 11]]),
                input_sample_rate: u32::from_le_bytes([
                    bytes[pos + 12],
                    bytes[pos + 13],
                    bytes[pos + 14],
                    bytes[pos + 15],
                ]),
            });
        }
    }
    Err(CoreError::Unsupported("Ogg stream is not Opus".into()))
}

fn find_slice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

pub fn looks_like_opus(bytes: &[u8]) -> bool {
    identify_ogg_opus(bytes).is_ok() || bytes.windows(8).any(|w| w == OPUS_HEAD || w == OPUS_TAGS)
}

/// RFC 8251 / 6716 gate. Vectors live in `tests/corpus/opus/` when present.
pub fn rfc_vectors_available(dir: &std::path::Path) -> bool {
    dir.join("testvector01.bit").is_file() || dir.join("01.opus").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_ogg() {
        assert!(identify_ogg_opus(b"fLaC....").is_err());
    }
}

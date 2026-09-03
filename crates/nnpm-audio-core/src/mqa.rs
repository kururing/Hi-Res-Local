//! MQA detection and software 2× upsample path (not licensed MQA Core decode).

use std::io::{Read, Seek, SeekFrom};

use serde::{Deserialize, Serialize};

use crate::error::CoreResult;
use crate::source::MediaSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MqaStatus {
    None,
    Mqa,
    MqaStudio,
    MqaAuthenticated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MqaEvidence {
    Metadata,
    PayloadVerified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MqaInfo {
    pub status: MqaStatus,
    pub evidence: Option<MqaEvidence>,
    pub orig_sample_rate: Option<u32>,
    pub orig_bit_depth: Option<u16>,
    pub unfolded_rate: Option<u32>,
    pub has_mqa_renderer: bool,
}

impl MqaInfo {
    pub fn none() -> Self {
        Self {
            status: MqaStatus::None,
            evidence: None,
            orig_sample_rate: None,
            orig_bit_depth: None,
            unfolded_rate: None,
            has_mqa_renderer: false,
        }
    }

    pub fn is_mqa(&self) -> bool {
        self.status != MqaStatus::None
    }

    pub fn payload_verified(&self) -> bool {
        self.evidence == Some(MqaEvidence::PayloadVerified)
    }
}

pub struct MqaDetector;

impl MqaDetector {
    pub fn detect(source: &mut MediaSource, tags: &[(&str, &str)]) -> CoreResult<MqaInfo> {
        let from_tags = classify_tags(tags);
        let bitstream = detect_bitstream(source).unwrap_or(false);
        if from_tags == MqaStatus::None && !bitstream {
            return Ok(MqaInfo::none());
        }
        let status = if from_tags != MqaStatus::None {
            from_tags
        } else {
            MqaStatus::Mqa
        };
        let orig = orig_rate_from_tags(tags);
        let unfolded = orig.map(|rate| {
            if rate <= 48_000 {
                rate.saturating_mul(2)
            } else {
                rate
            }
        });
        Ok(MqaInfo {
            status,
            evidence: Some(if bitstream {
                MqaEvidence::PayloadVerified
            } else {
                MqaEvidence::Metadata
            }),
            orig_sample_rate: orig,
            orig_bit_depth: orig_bit_depth_from_tags(tags),
            unfolded_rate: unfolded,
            has_mqa_renderer: false,
        })
    }
}

fn orig_bit_depth_from_tags(tags: &[(&str, &str)]) -> Option<u16> {
    tags.iter().find_map(|(key, value)| {
        (key.eq_ignore_ascii_case("ORIGINALBITDEPTH")
            || key.eq_ignore_ascii_case("MQABITDEPTH")
            || key.eq_ignore_ascii_case("ORIGBITDEPTH"))
        .then(|| value.trim().parse::<u16>().ok())
        .flatten()
    })
}

pub fn is_mqa_metadata_tag(key: &str, value: &str) -> bool {
    let k = key.trim().to_ascii_uppercase();
    let v = value.trim().to_ascii_uppercase();
    k == "MQAENCODER" || k == "MQA_ENCODER" || (k == "ENCODER" && v.starts_with("MQAENCODE"))
}

pub fn classify_tags(tags: &[(&str, &str)]) -> MqaStatus {
    let mut found = false;
    let mut studio = false;
    let mut auth = false;
    for (key, value) in tags {
        if !is_mqa_metadata_tag(key, value) && !key.eq_ignore_ascii_case("ORIGINALSAMPLERATE") {
            continue;
        }
        if is_mqa_metadata_tag(key, value) {
            found = true;
            let v = value.to_ascii_uppercase();
            if v.contains("STUDIO") {
                studio = true;
            }
            if v.contains("AUTHENTIC") {
                auth = true;
            }
        }
    }
    if auth {
        MqaStatus::MqaAuthenticated
    } else if studio {
        MqaStatus::MqaStudio
    } else if found {
        MqaStatus::Mqa
    } else {
        MqaStatus::None
    }
}

fn orig_rate_from_tags(tags: &[(&str, &str)]) -> Option<u32> {
    for (key, value) in tags {
        if key.eq_ignore_ascii_case("ORIGINALSAMPLERATE")
            || key.eq_ignore_ascii_case("MQASAMPLERATE")
            || key.eq_ignore_ascii_case("ORIGSAMPLERATE")
        {
            if let Ok(rate) = value.trim().parse::<u32>() {
                return Some(rate);
            }
        }
    }
    None
}

fn detect_bitstream(source: &mut MediaSource) -> CoreResult<bool> {
    #[cfg(feature = "mqa")]
    {
        source.seek(SeekFrom::Start(0))?;
        let mut head = vec![0u8; 16];
        let n = source.read(&mut head)?;
        if n < 4 || &head[..4] != b"fLaC" {
            source.seek(SeekFrom::Start(0))?;
            return Ok(false);
        }
        source.seek(SeekFrom::Start(0))?;
        // Identify directly from the seekable source. This avoids allocating a
        // complete album-sized FLAC while still verifying normal files above
        // the former 8 MiB cutoff.
        let identified = mqa_identify::identify_mqa_reader(&mut *source).unwrap_or(false);
        source.seek(SeekFrom::Start(0))?;
        Ok(identified)
    }
    #[cfg(not(feature = "mqa"))]
    {
        let _ = source;
        Ok(false)
    }
}

/// Software 2× upsample for non-renderer DACs. Not MQA Core unfold.
pub fn unfolded_target_rate(encoded_rate: u32) -> u32 {
    match encoded_rate {
        44_100 => 88_200,
        48_000 => 96_000,
        other if other <= 48_000 => other.saturating_mul(2),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_detection_no_false_positive() {
        assert!(is_mqa_metadata_tag("MQAENCODER", "MQAEncode v1.1"));
        assert!(!is_mqa_metadata_tag("ENCODER", "reference libFLAC 1.4.3"));
        assert_eq!(
            classify_tags(&[("MQAENCODER", "MQAEncode Studio")]),
            MqaStatus::MqaStudio
        );
        let mut source = MediaSource::from_bytes("tag.flac", b"not a flac payload".to_vec());
        let info = MqaDetector::detect(&mut source, &[("MQAENCODER", "MQAEncode")]).unwrap();
        assert_eq!(info.evidence, Some(MqaEvidence::Metadata));
        assert_eq!(info.orig_sample_rate, None);
        assert_eq!(info.orig_bit_depth, None);
    }
}

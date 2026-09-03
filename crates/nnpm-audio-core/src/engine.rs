use serde::{Deserialize, Serialize};

use crate::error::CoreResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Rust,
    Compare,
}

impl EngineKind {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "compare" => Self::Compare,
            _ => Self::Rust,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::Compare => "compare",
        }
    }
}

pub fn resolve_engine_kind() -> EngineKind {
    if let Ok(value) = std::env::var("NNPM_AUDIO_ENGINE") {
        return EngineKind::parse(&value);
    }
    EngineKind::Rust
}

pub fn hash_f32_samples(samples: &[f32]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for sample in samples {
        hasher.update(sample.to_le_bytes());
    }
    hasher.finalize().into()
}

pub fn max_abs_diff(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut max = (a.len() as f32 - b.len() as f32).abs();
    for i in 0..n {
        max = max.max((a[i] - b[i]).abs());
    }
    max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_engine_kinds() {
        assert_eq!(EngineKind::parse("rust"), EngineKind::Rust);
        assert_eq!(EngineKind::parse("compare"), EngineKind::Compare);
        assert_eq!(EngineKind::parse("removed-engine"), EngineKind::Rust);
    }

    #[test]
    fn sample_hash_is_stable() {
        let a = [0.1f32, -0.2, 0.3];
        assert_eq!(hash_f32_samples(&a), hash_f32_samples(&a));
        assert!(max_abs_diff(&a, &a) < f32::EPSILON);
    }
}

pub fn compare_pcm(reference: &[f32], candidate: &[f32], threshold: f32) -> CoreResult<()> {
    if reference.len() != candidate.len() {
        return Err(crate::error::CoreError::Decode(format!(
            "compare length mismatch {} vs {}",
            reference.len(),
            candidate.len()
        )));
    }
    let err = max_abs_diff(reference, candidate);
    if err > threshold {
        return Err(crate::error::CoreError::Decode(format!(
            "compare max abs diff {err} exceeds {threshold}"
        )));
    }
    Ok(())
}

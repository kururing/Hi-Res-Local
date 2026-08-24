use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncedLyricLine {
    pub timestamp_ms: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub romanized: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LyricsData {
    pub is_synced: bool,
    pub lines: Vec<SyncedLyricLine>,
    pub plain_text: String,
    pub source: LyricsSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub romanized: Option<Box<LyricsData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LyricsSource {
    Embedded,
    LrcFile,
    None,
}

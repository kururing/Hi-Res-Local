use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayHistoryEntry {
    pub id: i64,
    pub track_id: String,
    pub track: Option<crate::models::track::Track>,
    pub played_at: String,
    pub completed_duration_ms: u64,
    pub fully_played: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordPlayInput {
    pub track_id: String,
    pub completed_duration_ms: u64,
    pub fully_played: bool,
}

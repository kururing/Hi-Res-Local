use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AlbumSummary {
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub cover_art_path: Option<String>,
    pub track_count: u32,
    pub total_duration_ms: u64,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumDetail {
    pub summary: AlbumSummary,
    pub tracks: Vec<crate::models::track::Track>,
}

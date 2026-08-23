use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtistSummary {
    pub name: String,
    pub album_count: u32,
    pub track_count: u32,
    pub total_duration_ms: u64,
    pub is_favorite: bool,
    pub cover_art_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistDetail {
    pub summary: ArtistSummary,
    pub albums: Vec<crate::models::album::AlbumSummary>,
    pub tracks: Vec<crate::models::track::Track>,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_smart: bool,
    pub rules_json: Option<String>,
    pub cover_art_path: Option<String>,
    pub track_count: u32,
    pub total_duration_ms: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistWithTracks {
    pub playlist: Playlist,
    pub tracks: Vec<crate::models::track::Track>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlaylistInput {
    pub name: String,
    pub description: Option<String>,
    pub is_smart: Option<bool>,
    pub rules_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlaylistInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub rules_json: Option<String>,
    pub cover_art_path: Option<String>,
}

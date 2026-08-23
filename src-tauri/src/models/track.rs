use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub duration_ms: u64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub format: String,
    pub file_size: u64,
    pub file_modified_at: String,
    pub date_added: String,
    pub is_favorite: bool,
    pub rating: u8,
    pub play_count: u32,
    pub skip_count: u32,
    pub last_played_at: Option<String>,
    pub cover_art_path: Option<String>,
    pub lyrics: Option<String>,
    pub has_synced_lyrics: bool,
    pub is_corrupt: bool,
    pub corrupt_reason: Option<String>,
    pub duplicate_group_id: Option<String>,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackUpdateTags {
    pub id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub lyrics: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackFilter {
    pub search_query: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub is_favorite: Option<bool>,
    pub min_rating: Option<u8>,
    pub is_corrupt: Option<bool>,
    pub duplicate_only: Option<bool>,
    pub sort_by: Option<TrackSortField>,
    pub sort_desc: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrackSortField {
    Title,
    Artist,
    Album,
    Year,
    Duration,
    DateAdded,
    PlayCount,
    Rating,
    Bitrate,
    TrackNumber,
}

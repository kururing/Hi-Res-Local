use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GenreSummary {
    pub name: String,
    pub track_count: u32,
    pub album_count: u32,
    pub artist_count: u32,
}

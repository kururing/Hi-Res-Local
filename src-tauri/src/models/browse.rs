use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeFeed {
    pub recently_added: Vec<crate::models::track::Track>,
    pub most_played: Vec<crate::models::track::Track>,
    pub recently_played: Vec<crate::models::track::Track>,
    pub favorite_tracks: Vec<crate::models::track::Track>,
    pub favorite_albums: Vec<crate::models::album::AlbumSummary>,
    pub favorite_artists: Vec<crate::models::artist::ArtistSummary>,
    pub total_tracks: u32,
    pub total_albums: u32,
    pub total_artists: u32,
    pub total_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub query: String,
    pub tracks: Vec<crate::models::track::Track>,
    pub albums: Vec<crate::models::album::AlbumSummary>,
    pub artists: Vec<crate::models::artist::ArtistSummary>,
    pub genres: Vec<crate::models::genre::GenreSummary>,
    pub playlists: Vec<crate::models::playlist::Playlist>,
}

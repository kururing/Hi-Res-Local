//! Library scanning, metadata extraction, and SQLite storage module placeholder.
//!
//! This module provides a placeholder implementation of [`LibraryBackend`].
//! Feature workers can expand scanning, tag extraction, and SQLite queries here.

use crate::app::{LibraryBackend, LibraryStats, Playlist, Track, TrackId};
use std::path::Path;

/// Placeholder implementation of library indexing and storage backend.
#[derive(Debug, Default)]
pub struct LibraryManager;

impl LibraryManager {
    pub fn new() -> Self {
        Self
    }
}

impl LibraryBackend for LibraryManager {
    fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }

    fn scan_directory(
        &self,
        _path: &Path,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Vec::new())
    }

    fn get_all_tracks(&self) -> Result<Vec<Track>, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Vec::new())
    }

    fn get_track_by_id(
        &self,
        _id: &TrackId,
    ) -> Result<Option<Track>, Box<dyn std::error::Error + Send + Sync>> {
        Ok(None)
    }

    fn get_playlists(&self) -> Result<Vec<Playlist>, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Vec::new())
    }

    fn get_stats(&self) -> LibraryStats {
        LibraryStats::default()
    }
}

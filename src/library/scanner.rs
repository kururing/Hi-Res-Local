//! Recursive filesystem audio scanner module.

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::app::Track;
use crate::library::metadata::{extract_metadata, is_supported_audio_file};

/// Discovers all audio files within a root directory recursively.
///
/// Ignores unreadable directories or broken symlinks gracefully.
pub fn discover_audio_files(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();

    if !root.exists() {
        tracing::warn!("Scan root does not exist: {:?}", root);
        return results;
    }

    if root.is_file() {
        if is_supported_audio_file(root) {
            results.push(root.to_path_buf());
        }
        return results;
    }

    for entry in WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && is_supported_audio_file(path) {
            results.push(path.to_path_buf());
        }
    }

    results
}

/// Recursively scans a root directory and extracts metadata for all discovered audio files.
///
/// Corrupt or unreadable files do not abort the scan process.
pub fn scan_directory_tracks(root: &Path) -> Vec<Track> {
    let audio_files = discover_audio_files(root);
    let mut tracks = Vec::with_capacity(audio_files.len());

    for file_path in audio_files {
        match extract_metadata(&file_path) {
            Ok(track) => tracks.push(track),
            Err(err) => {
                tracing::warn!("Skipping unreadable file {:?}: {}", file_path, err);
            }
        }
    }

    tracks
}

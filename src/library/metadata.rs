//! Audio metadata extraction and deterministic ID generation module.

use chrono::Utc;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

use crate::app::{Track, TrackId};
use crate::library::error::LibraryError;

/// Supported audio extensions (lowercase).
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "alac", "aiff", "aif", "ape", "wma", "oga",
    "mka",
];

/// Checks whether a given path has a supported audio extension.
pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

/// Generates a deterministic, stable [`TrackId`] from a file path.
///
/// Canonicalizes or normalizes path separators to ensure consistent IDs
/// across runs and platforms.
pub fn generate_deterministic_track_id(path: &Path) -> TrackId {
    let normalized = normalize_path_for_id(path);
    let mut h1: u64 = 0xcbf29ce484222325;
    let mut h2: u64 = 0x100000001b3;
    for &b in normalized.as_bytes() {
        h1 = (h1 ^ (b as u64)).wrapping_mul(0x100000001b3);
        h2 = (h2 ^ ((b as u64).rotate_left(3))).wrapping_mul(0xcbf29ce484222325);
    }
    let mut bytes = [0u8; 16];
    bytes[0..8].copy_from_slice(&h1.to_be_bytes());
    bytes[8..16].copy_from_slice(&h2.to_be_bytes());
    // RFC4122 UUID layout: version 5 (name-based), variant 1
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    TrackId(Uuid::from_bytes(bytes))
}

/// Normalizes a path to a consistent string representation for hashing.
pub fn normalize_path_for_id(path: &Path) -> String {
    // Attempt canonicalization if file exists, otherwise use raw path
    let path_buf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut path_str = path_buf.to_string_lossy().to_string();

    // Strip Windows extended-length prefix \\?\ if present
    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        path_str = stripped.to_string();
    }

    // Normalize backslashes to forward slashes for cross-platform stability
    path_str = path_str.replace('\\', "/");

    #[cfg(target_os = "windows")]
    {
        // On Windows file systems, paths are case-insensitive
        path_str = path_str.to_ascii_lowercase();
    }

    path_str
}

/// Cleans a filename stem into a human-friendly track title fallback.
pub fn filename_fallback_title(path: &Path) -> String {
    let stem = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return "Unknown Title".to_string(),
    };

    // Strip common leading track number patterns like "01 - ", "01. ", "01_ ", "01 "
    let mut cleaned = stem;
    if let Some(pos) = stem.find(|c: char| !c.is_ascii_digit()) {
        if pos > 0 && pos <= 4 {
            let rest = &stem[pos..];
            let rest_trimmed = rest
                .trim_start_matches(|c: char| c == '-' || c == '.' || c == '_' || c == ' ')
                .trim();
            if !rest_trimmed.is_empty() {
                cleaned = rest_trimmed;
            }
        }
    }

    // Replace underscores with spaces
    let replaced = cleaned.replace('_', " ");
    let final_title = replaced.trim();

    if final_title.is_empty() {
        "Unknown Title".to_string()
    } else {
        final_title.to_string()
    }
}

/// Fallback album detection from parent directory name.
pub fn directory_fallback_album(path: &Path) -> String {
    path.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.replace('_', " "))
        .unwrap_or_else(|| "Unknown Album".to_string())
}

/// Reads metadata from an audio file using Lofty with robust fallbacks.
///
/// Even if the file has corrupted or missing tags, this function extracts
/// basic properties and falls back to clean filename heuristics so that
/// scanning never fails unnecessarily.
pub fn extract_metadata(path: &Path) -> Result<Track, LibraryError> {
    let abs_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let track_id = generate_deterministic_track_id(&abs_path);

    // Try lofty probe first
    match Probe::open(&abs_path).and_then(|p| p.read()) {
        Ok(tagged_file) => {
            let properties = tagged_file.properties();
            let duration = properties.duration();
            let bitrate = properties
                .audio_bitrate()
                .or_else(|| properties.overall_bitrate());
            let sample_rate = properties.sample_rate();
            let channels = properties.channels().map(|c| c as u16);
            let bit_depth = properties.bit_depth();

            let primary_tag = tagged_file
                .primary_tag()
                .or_else(|| tagged_file.first_tag());

            let title = primary_tag
                .and_then(|t| t.title())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| filename_fallback_title(&abs_path));

            let artist = primary_tag
                .and_then(|t| t.artist())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Unknown Artist".to_string());

            let album = primary_tag
                .and_then(|t| t.album())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| directory_fallback_album(&abs_path));

            let genre = primary_tag
                .and_then(|t| t.genre())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let track_number = primary_tag.and_then(|t| t.track());
            let disc_number = primary_tag.and_then(|t| t.disk());
            let year = primary_tag.and_then(|t| t.year());

            Ok(Track {
                id: track_id,
                title,
                artist,
                album,
                duration,
                path: abs_path,
                track_number,
                disc_number,
                year,
                genre,
                sample_rate,
                bitrate,
                channels,
                bit_depth,
                date_added: Utc::now(),
            })
        }
        Err(err) => {
            tracing::warn!(
                "Lofty metadata probe failed for {:?}: {}. Using filename fallbacks.",
                abs_path,
                err
            );

            // Robust fallback if file exists
            if abs_path.exists() {
                Ok(Track {
                    id: track_id,
                    title: filename_fallback_title(&abs_path),
                    artist: "Unknown Artist".to_string(),
                    album: directory_fallback_album(&abs_path),
                    duration: Duration::ZERO,
                    path: abs_path,
                    track_number: None,
                    disc_number: None,
                    year: None,
                    genre: None,
                    sample_rate: None,
                    bitrate: None,
                    channels: None,
                    bit_depth: None,
                    date_added: Utc::now(),
                })
            } else {
                Err(LibraryError::Metadata {
                    path: abs_path.to_string_lossy().to_string(),
                    message: format!("File does not exist: {err}"),
                })
            }
        }
    }
}

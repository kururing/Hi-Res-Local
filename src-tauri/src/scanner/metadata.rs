use chrono::{DateTime, Utc};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use std::fs;
use std::path::Path;
use uuid::Uuid;

use crate::lyrics::lrc_parser::load_lyrics_for_track;
use crate::models::track::Track;
use crate::scanner::cover_cache::extract_and_cache_cover;

/// Generates a deterministic stable UUID string from normalized path.
pub fn generate_track_id(path: &Path) -> String {
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
    // UUID v5 RFC4122
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

pub fn normalize_path_for_id(path: &Path) -> String {
    let path_buf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut path_str = path_buf.to_string_lossy().to_string();

    if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        path_str = stripped.to_string();
    }

    path_str = path_str.replace('\\', "/");

    #[cfg(target_os = "windows")]
    {
        path_str = path_str.to_ascii_lowercase();
    }

    path_str
}

pub fn clean_filename_fallback(path: &Path) -> String {
    let stem = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => return "Unknown Title".to_string(),
    };

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

    let replaced = cleaned.replace('_', " ");
    let final_str = replaced.trim();
    if final_str.is_empty() {
        "Unknown Title".to_string()
    } else {
        final_str.to_string()
    }
}

pub fn extract_metadata(path: &Path) -> Track {
    let id = generate_track_id(path);
    let path_str = path.to_string_lossy().to_string();
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_ascii_lowercase();

    let (file_size, file_modified_at) = match fs::metadata(path) {
        Ok(m) => {
            let size = m.len();
            let modified = m
                .modified()
                .ok()
                .map(|t| DateTime::<Utc>::from(t).to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339());
            (size, modified)
        }
        Err(_) => (0, Utc::now().to_rfc3339()),
    };

    let now_str = Utc::now().to_rfc3339();

    // Probe audio file with lofty
    let probe_res = Probe::open(path)
        .map_err(|e| e.to_string())
        .and_then(|p| p.read().map_err(|e| e.to_string()));

    let tagged_file = match probe_res {
        Ok(tf) => tf,
        Err(err) => {
            // Return corrupt track representation
            return Track {
                id,
                path: path_str,
                title: clean_filename_fallback(path),
                artist: "Unknown Artist".to_string(),
                album_artist: None,
                album: "Unknown Album".to_string(),
                genre: None,
                year: None,
                track_number: None,
                disc_number: None,
                duration_ms: 0,
                bitrate: None,
                sample_rate: None,
                channels: None,
                format,
                file_size,
                file_modified_at,
                date_added: now_str,
                is_favorite: false,
                rating: 0,
                play_count: 0,
                skip_count: 0,
                last_played_at: None,
                cover_art_path: None,
                lyrics: None,
                has_synced_lyrics: false,
                is_corrupt: true,
                corrupt_reason: Some(format!("Failed to parse audio file tags/headers: {}", err)),
                duplicate_group_id: None,
                is_primary: true,
            };
        }
    };

    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as u64;
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();
    let channels = properties.channels().map(|c| c as u16);

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|t| t.title().as_deref().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| clean_filename_fallback(path));

    let artist = tag
        .and_then(|t| t.artist().as_deref().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Artist".to_string())
        });

    let album_artist = tag
        .and_then(|t| {
            t.get_string(&ItemKey::AlbumArtist)
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());

    let album = tag
        .and_then(|t| t.album().as_deref().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Album".to_string())
        });

    let genre = tag
        .and_then(|t| t.genre().as_deref().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty());

    let year = tag.and_then(|t| t.year());
    let track_number = tag.and_then(|t| t.track());
    let disc_number = tag.and_then(|t| t.disk());

    let embedded_lyrics = tag
        .and_then(|t| t.get_string(&ItemKey::Lyrics).map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty());

    // Cover art extraction & cache
    let cover_art_path = extract_and_cache_cover(Some(&tagged_file), path);

    // Lyrics detection
    let lyrics_info = load_lyrics_for_track(embedded_lyrics.as_deref(), path);
    let (lyrics_text, has_synced_lyrics) = match lyrics_info {
        Some(lrc) => (Some(lrc.plain_text), lrc.is_synced),
        None => (embedded_lyrics, false),
    };

    Track {
        id,
        path: path_str,
        title,
        artist,
        album_artist,
        album,
        genre,
        year,
        track_number,
        disc_number,
        duration_ms,
        bitrate,
        sample_rate,
        channels,
        format,
        file_size,
        file_modified_at,
        date_added: now_str,
        is_favorite: false,
        rating: 0,
        play_count: 0,
        skip_count: 0,
        last_played_at: None,
        cover_art_path,
        lyrics: lyrics_text,
        has_synced_lyrics,
        is_corrupt: false,
        corrupt_reason: None,
        duplicate_group_id: None,
        is_primary: true,
    }
}

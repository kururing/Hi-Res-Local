#![allow(clippy::chunks_exact_to_as_chunks)] // `as_chunks` is newer than the Rust 1.80 MSRV.

use chrono::{DateTime, Utc};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use std::fs;
use std::path::Path;
use uuid::Uuid;

use crate::audio::dsd::probe_path;
use crate::lyrics::lrc_parser::load_lyrics_for_track;
use crate::models::track::Track;
use crate::scanner::cover_cache::{extract_and_cache_cover, extract_and_cache_cover_bytes};

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
            let rest_trimmed = rest.trim_start_matches(['-', '.', '_', ' ']).trim();
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

pub fn file_identity(path: &Path) -> (u64, String) {
    match fs::metadata(path) {
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
    }
}

fn format_from_path(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_ascii_lowercase()
}

fn corrupt_track(path: &Path, reason: String) -> Track {
    let (file_size, file_modified_at) = file_identity(path);
    Track {
        id: generate_track_id(path),
        path: path.to_string_lossy().to_string(),
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
        bit_depth: None,
        format: format_from_path(path),
        file_size,
        file_modified_at,
        date_added: Utc::now().to_rfc3339(),
        is_favorite: false,
        rating: 0,
        play_count: 0,
        skip_count: 0,
        last_played_at: None,
        cover_art_path: None,
        lyrics: None,
        has_synced_lyrics: false,
        is_corrupt: true,
        corrupt_reason: Some(reason),
        duplicate_group_id: None,
        is_primary: true,
    }
}

/// Extracts metadata for a file. A corrupt or panicking parser never aborts the scan.
pub fn extract_metadata_safe(path: &Path) -> Track {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| extract_metadata(path))) {
        Ok(track) => track,
        Err(_) => {
            tracing::warn!("Metadata parser panicked on {}", path.display());
            corrupt_track(
                path,
                "Metadata parser panicked on corrupt or unsupported file".to_string(),
            )
        }
    }
}

pub fn extract_metadata(path: &Path) -> Track {
    let id = generate_track_id(path);
    let path_str = path.to_string_lossy().to_string();
    let format = format_from_path(path);
    let (file_size, file_modified_at) = file_identity(path);
    let now_str = Utc::now().to_rfc3339();

    if matches!(format.as_str(), "dsf" | "dff") {
        return extract_dsd_metadata(
            path,
            id,
            path_str,
            format,
            file_size,
            file_modified_at,
            now_str,
        );
    }

    let probe_res = Probe::open(path)
        .map_err(|e| e.to_string())
        .and_then(|p| p.read().map_err(|e| e.to_string()));

    let tagged_file = match probe_res {
        Ok(tf) => tf,
        Err(err) => {
            return corrupt_track(
                path,
                format!("Failed to parse audio file tags/headers: {}", err),
            );
        }
    };

    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as u64;
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();
    let channels = properties.channels().map(|c| c as u16);
    let bit_depth = properties.bit_depth();

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
        bit_depth,
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

#[derive(Default)]
struct DsdId3Tag {
    title: Option<String>,
    artist: Option<String>,
    album_artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    year: Option<u32>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    lyrics: Option<String>,
    picture: Option<Vec<u8>>,
}

fn extract_dsd_metadata(
    path: &Path,
    id: String,
    path_str: String,
    format: String,
    file_size: u64,
    file_modified_at: String,
    now_str: String,
) -> Track {
    let parsed = match probe_path(path) {
        Ok(value) => value,
        Err(err) => {
            return corrupt_track(path, format!("Failed to parse DSD headers: {err}"));
        }
    };
    let tag = parsed.id3.as_deref().map(parse_id3v2).unwrap_or_default();
    let title = tag
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| clean_filename_fallback(path));
    let artist = tag
        .artist
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| parent_name(path))
        .unwrap_or_else(|| "Unknown Artist".into());
    let album = tag
        .album
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| parent_name(path))
        .unwrap_or_else(|| "Unknown Album".into());
    let lyrics_info = load_lyrics_for_track(tag.lyrics.as_deref(), path);
    let (lyrics, has_synced_lyrics) = match lyrics_info {
        Some(info) => (Some(info.plain_text), info.is_synced),
        None => (tag.lyrics.clone(), false),
    };
    let cover_art_path = extract_and_cache_cover_bytes(tag.picture.as_deref(), path);

    Track {
        id,
        path: path_str,
        title,
        artist,
        album_artist: tag.album_artist,
        album,
        genre: tag.genre,
        year: tag.year,
        track_number: tag.track_number,
        disc_number: tag.disc_number,
        duration_ms: parsed.duration_ms,
        bitrate: Some(
            ((u64::from(parsed.dsd_sample_rate) * u64::from(parsed.channels)) / 1000)
                .min(u64::from(u32::MAX)) as u32,
        ),
        sample_rate: Some(parsed.dsd_sample_rate),
        channels: Some(parsed.channels),
        bit_depth: Some(1),
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
        lyrics,
        has_synced_lyrics,
        is_corrupt: false,
        corrupt_reason: None,
        duplicate_group_id: None,
        is_primary: true,
    }
}

fn parent_name(path: &Path) -> Option<String> {
    path.parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .filter(|name| !name.trim().is_empty())
}

fn parse_id3v2(data: &[u8]) -> DsdId3Tag {
    let mut tag = DsdId3Tag::default();
    if data.len() < 10 || &data[0..3] != b"ID3" {
        return tag;
    }
    let version = data[3];
    let flags = data[5];
    let declared = synchsafe(&data[6..10]) as usize;
    let end = 10usize.saturating_add(declared).min(data.len());
    let mut pos = 10usize;
    let unsynchronised = flags & 0x80 != 0;
    while pos + 10 <= end {
        if data[pos..pos + 4].iter().all(|byte| *byte == 0) {
            break;
        }
        let id = &data[pos..pos + 4];
        let raw_size = &data[pos + 4..pos + 8];
        let size = if version >= 4 {
            synchsafe(raw_size) as usize
        } else {
            u32::from_be_bytes(raw_size.try_into().unwrap()) as usize
        };
        pos += 10;
        let frame_end = pos.saturating_add(size).min(end);
        if frame_end <= pos {
            break;
        }
        let mut payload = data[pos..frame_end].to_vec();
        if unsynchronised {
            payload = remove_unsynchronisation(&payload);
        }
        match id {
            b"TIT2" => tag.title = decode_id3_text(&payload),
            b"TPE1" => tag.artist = decode_id3_text(&payload),
            b"TPE2" => tag.album_artist = decode_id3_text(&payload),
            b"TALB" => tag.album = decode_id3_text(&payload),
            b"TCON" => tag.genre = decode_id3_text(&payload),
            b"TDRC" | b"TYER" => {
                tag.year = decode_id3_text(&payload).and_then(|value| {
                    value
                        .chars()
                        .take(4)
                        .collect::<String>()
                        .parse::<u32>()
                        .ok()
                });
            }
            b"TRCK" => tag.track_number = parse_number_frame(&payload),
            b"TPOS" => tag.disc_number = parse_number_frame(&payload),
            b"USLT" => tag.lyrics = decode_unsynchronised_lyrics(&payload),
            b"APIC" => tag.picture = parse_apic(&payload),
            _ => {}
        }
        pos = pos.saturating_add(size);
    }
    tag
}

fn synchsafe(bytes: &[u8]) -> u32 {
    if bytes.len() < 4 {
        return 0;
    }
    (u32::from(bytes[0] & 0x7f) << 21)
        | (u32::from(bytes[1] & 0x7f) << 14)
        | (u32::from(bytes[2] & 0x7f) << 7)
        | u32::from(bytes[3] & 0x7f)
}

fn remove_unsynchronisation(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut previous_ff = false;
    for &byte in bytes {
        if previous_ff && byte == 0 {
            previous_ff = false;
            continue;
        }
        previous_ff = byte == 0xff;
        out.push(byte);
    }
    out
}

fn decode_id3_text(payload: &[u8]) -> Option<String> {
    let encoding = *payload.first()?;
    let bytes = &payload[1..];
    let text = match encoding {
        0 => String::from_utf8_lossy(bytes).to_string(),
        1 => decode_utf16(bytes, true),
        2 => decode_utf16(bytes, false),
        3 => String::from_utf8_lossy(bytes).to_string(),
        _ => return None,
    };
    let cleaned = text.trim_matches('\0').trim().to_string();
    (!cleaned.is_empty()).then_some(cleaned)
}

fn decode_utf16(bytes: &[u8], has_bom: bool) -> String {
    let mut data = bytes;
    let little_endian = if has_bom && bytes.len() >= 2 {
        match bytes[..2] {
            [0xff, 0xfe] => {
                data = &bytes[2..];
                true
            }
            [0xfe, 0xff] => {
                data = &bytes[2..];
                false
            }
            _ => true,
        }
    } else {
        false
    };
    let units = data
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

fn parse_number_frame(payload: &[u8]) -> Option<u32> {
    decode_id3_text(payload)?
        .split('/')
        .next()?
        .trim()
        .parse()
        .ok()
}

fn decode_unsynchronised_lyrics(payload: &[u8]) -> Option<String> {
    if payload.len() < 5 {
        return None;
    }
    let encoding = payload[0];
    let mut pos = 4usize;
    let delimiter = if encoding == 1 || encoding == 2 { 2 } else { 1 };
    while pos + delimiter <= payload.len() {
        let zero = if delimiter == 1 {
            payload[pos] == 0
        } else {
            payload[pos] == 0 && payload[pos + 1] == 0
        };
        if zero {
            pos += delimiter;
            break;
        }
        pos += 1;
    }
    decode_id3_text(
        &[encoding]
            .into_iter()
            .chain(payload[pos..].iter().copied())
            .collect::<Vec<_>>(),
    )
}

fn parse_apic(payload: &[u8]) -> Option<Vec<u8>> {
    let encoding = *payload.first()?;
    let mut pos = 1usize;
    while pos < payload.len() && payload[pos] != 0 {
        pos += 1;
    }
    pos = pos.saturating_add(1).saturating_add(1);
    let delimiter = if encoding == 1 || encoding == 2 { 2 } else { 1 };
    while pos + delimiter <= payload.len() {
        let done = if delimiter == 1 {
            payload[pos] == 0
        } else {
            payload[pos] == 0 && payload[pos + 1] == 0
        };
        if done {
            pos += delimiter;
            return (pos < payload.len()).then(|| payload[pos..].to_vec());
        }
        pos += 1;
    }
    None
}

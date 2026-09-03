#![allow(clippy::chunks_exact_to_as_chunks)] // `as_chunks` is newer than the Rust 1.80 MSRV.

use chrono::{DateTime, Utc};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use uuid::Uuid;

use crate::audio::dsd::probe_path;
use crate::audio::AudioDecoder;
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
        is_mqa: false,
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
        isrc: None,
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
            if format == "wav" {
                tracing::warn!(
                    "Lofty failed to parse WAV metadata for {}; falling back to core decoder: {}",
                    path.display(),
                    err
                );
                return extract_wav_metadata_from_core(
                    path,
                    id,
                    path_str,
                    format,
                    file_size,
                    file_modified_at,
                    now_str,
                )
                .unwrap_or_else(|fallback_err| {
                    corrupt_track(
                        path,
                        format!(
                            "Failed to parse audio file tags/headers: {err}; decoder fallback failed: {fallback_err}"
                        ),
                    )
                });
            }
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
    let is_mqa = tag.is_some_and(tag_indicates_mqa);

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

    let isrc = tag
        .and_then(|t| t.get_string(&ItemKey::Isrc).map(|s| s.trim().to_uppercase()))
        .filter(|s| !s.is_empty());

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
        is_mqa,
        isrc,
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

fn extract_wav_metadata_from_core(
    path: &Path,
    id: String,
    path_str: String,
    format: String,
    file_size: u64,
    file_modified_at: String,
    now_str: String,
) -> Result<Track, String> {
    let decoder = AudioDecoder::open(path).map_err(|err| err.to_string())?;
    let quality = decoder.quality_badge().clone();
    let tags = read_wav_list_info(path);
    let id3 = read_wav_id3_tag(path).unwrap_or_default();

    let title = info_tag(&tags, &["title"])
        .or(id3.title.clone())
        .unwrap_or_else(|| clean_filename_fallback(path));
    let artist = info_tag(&tags, &["artist"])
        .or(id3.artist.clone())
        .or_else(|| parent_name(path))
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let album_artist = info_tag(&tags, &["album_artist", "albumartist", "album artist"])
        .or(id3.album_artist.clone());
    let album = info_tag(&tags, &["album"])
        .or(id3.album.clone())
        .or_else(|| parent_name(path))
        .unwrap_or_else(|| "Unknown Album".to_string());
    let genre = info_tag(&tags, &["genre"]).or(id3.genre.clone());
    let year = parse_info_year(info_tag(&tags, &["date", "year"])).or(id3.year);
    let track_number =
        parse_info_number(info_tag(&tags, &["track", "tracknumber", "track_number"]))
            .or(id3.track_number);
    let disc_number = parse_info_number(info_tag(&tags, &["disc", "discnumber", "disc_number"]))
        .or(id3.disc_number);
    let embedded_lyrics =
        info_tag(&tags, &["lyrics", "unsyncedlyrics", "unsynced_lyrics"]).or(id3.lyrics.clone());
    let lyrics_info = load_lyrics_for_track(embedded_lyrics.as_deref(), path);
    let (lyrics, has_synced_lyrics) = match lyrics_info {
        Some(info) => (Some(info.plain_text), info.is_synced),
        None => (embedded_lyrics, false),
    };
    let cover_art_path = extract_and_cache_cover_bytes(id3.picture.as_deref(), path);

    Ok(Track {
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
        duration_ms: decoder.duration_ms(),
        bitrate: quality.bitrate_kbps,
        sample_rate: Some(decoder.sample_rate()).filter(|rate| *rate > 0),
        channels: Some(decoder.channels()).filter(|channels| *channels > 0),
        bit_depth: u8::try_from(decoder.bit_depth())
            .ok()
            .filter(|depth| *depth > 0),
        is_mqa: info_tags_indicate_mqa(&tags),
        isrc: info_tag(&tags, &["isrc", "tsrc"])
            .or(id3.isrc.clone())
            .map(|value| value.trim().to_uppercase())
            .filter(|value| !value.is_empty()),
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
    })
}

fn read_wav_list_info(path: &Path) -> HashMap<String, String> {
    let bytes = std::fs::read(path).unwrap_or_default();
    parse_riff_info_tags(&bytes)
}

fn parse_riff_info_tags(bytes: &[u8]) -> HashMap<String, String> {
    let mut tags = HashMap::new();
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return tags;
    }
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size =
            u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap_or([0; 4])) as usize;
        let start = offset + 8;
        let end = start.saturating_add(size).min(bytes.len());
        if id == b"LIST" && end.saturating_sub(start) >= 4 && &bytes[start..start + 4] == b"INFO" {
            let mut inner = start + 4;
            while inner + 8 <= end {
                let key = bytes[inner..inner + 4].to_ascii_uppercase();
                let ksize =
                    u32::from_le_bytes(bytes[inner + 4..inner + 8].try_into().unwrap_or([0; 4]))
                        as usize;
                let kstart = inner + 8;
                let kend = kstart.saturating_add(ksize).min(end);
                if let Ok(text) = std::str::from_utf8(&bytes[kstart..kend]) {
                    let value = text.trim_matches(['\0', ' ', '\r', '\n']);
                    if !value.is_empty() {
                        let mapped = match key.as_slice() {
                            b"INAM" => "title",
                            b"IART" => "artist",
                            b"IPRD" => "album",
                            b"IGNR" => "genre",
                            b"ICRD" | b"ICMT" => "date",
                            b"ITRK" => "track",
                            b"IENG" => "encoder",
                            other => {
                                insert_info_tag(
                                    &mut tags,
                                    std::str::from_utf8(other).unwrap_or("unknown"),
                                    value,
                                );
                                inner = kend + ksize % 2;
                                continue;
                            }
                        };
                        insert_info_tag(&mut tags, mapped, value);
                    }
                }
                inner = kend + ksize % 2;
            }
        }
        offset = end + size % 2;
    }
    tags
}

fn insert_info_tag(tags: &mut HashMap<String, String>, key: &str, value: &str) {
    let value = value.trim_matches(['\0', ' ', '\r', '\n']);
    if !value.is_empty() {
        tags.insert(key.trim().to_ascii_lowercase(), value.to_string());
    }
}

fn info_tag(tags: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| tags.get(*key))
        .cloned()
        .filter(|value| !value.trim().is_empty())
}

fn tag_indicates_mqa(tag: &Tag) -> bool {
    tag.items().any(|item| {
        let value = item
            .value()
            .text()
            .unwrap_or_default()
            .trim()
            .to_ascii_uppercase();
        match item.key() {
            ItemKey::Unknown(key) => {
                matches!(
                    key.trim().to_ascii_uppercase().as_str(),
                    "MQAENCODER" | "MQA_ENCODER"
                ) && !value.is_empty()
            }
            ItemKey::EncoderSoftware | ItemKey::EncoderSettings => value.starts_with("MQAENCODE"),
            _ => false,
        }
    })
}

fn info_tags_indicate_mqa(tags: &HashMap<String, String>) -> bool {
    info_tag(tags, &["mqaencoder", "mqa_encoder"]).is_some()
        || info_tag(tags, &["encoder", "encodersettings", "encoding"])
            .is_some_and(|value| value.trim().to_ascii_uppercase().starts_with("MQAENCODE"))
}

fn parse_info_number(value: Option<String>) -> Option<u32> {
    value?.split('/').next()?.trim().parse::<u32>().ok()
}

fn parse_info_year(value: Option<String>) -> Option<u32> {
    value?
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|part| part.len() == 4)?
        .parse::<u32>()
        .ok()
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
    isrc: Option<String>,
}

fn read_wav_id3_tag(path: &Path) -> Option<DsdId3Tag> {
    const MAX_ID3_CHUNK_BYTES: u32 = 32 * 1024 * 1024;

    let mut file = fs::File::open(path).ok()?;
    let mut riff_header = [0u8; 12];
    file.read_exact(&mut riff_header).ok()?;
    if !matches!(&riff_header[0..4], b"RIFF" | b"RF64") || &riff_header[8..12] != b"WAVE" {
        return None;
    }

    loop {
        let mut chunk_header = [0u8; 8];
        if file.read_exact(&mut chunk_header).is_err() {
            return None;
        }
        let chunk_size = u32::from_le_bytes(chunk_header[4..8].try_into().ok()?);
        if matches!(&chunk_header[0..4], b"id3 " | b"ID3 ") {
            if chunk_size == 0 || chunk_size > MAX_ID3_CHUNK_BYTES {
                return None;
            }
            let mut data = vec![0u8; chunk_size as usize];
            file.read_exact(&mut data).ok()?;
            return Some(parse_id3v2(&data));
        }

        let padded_size = u64::from(chunk_size) + u64::from(chunk_size & 1);
        let offset = i64::try_from(padded_size).ok()?;
        file.seek(SeekFrom::Current(offset)).ok()?;
    }
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
        is_mqa: false,
        isrc: tag
            .isrc
            .map(|value| value.trim().to_uppercase())
            .filter(|value| !value.is_empty()),
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
            b"TSRC" => {
                tag.isrc = decode_id3_text(&payload)
                    .map(|value| value.trim().to_uppercase())
                    .filter(|value| !value.is_empty());
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn append_riff_chunk(buffer: &mut Vec<u8>, id: &[u8; 4], payload: &[u8]) {
        buffer.extend_from_slice(id);
        buffer.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        buffer.extend_from_slice(payload);
        if payload.len() % 2 != 0 {
            buffer.push(0);
        }
    }

    fn write_wav_with_lowercase_info_key(path: &Path) {
        let mut info = b"INFO".to_vec();
        append_riff_chunk(&mut info, b"IART", b"Fallback Artist\0");
        append_riff_chunk(&mut info, b"INAM", b"Fallback Title\0");
        append_riff_chunk(&mut info, b"IPRD", b"Fallback Album\0");
        append_riff_chunk(&mut info, b"IGNR", b"Pop\0");
        append_riff_chunk(&mut info, b"ICRD", b"2017\0");
        // Lowercase RIFF INFO keys occur in real files exported by AudioGate.
        // Lofty rejects this malformed key, so normalize it before parsing.
        append_riff_chunk(&mut info, b"itrk", b"03\0");

        let channels = 2u16;
        let sample_rate = 96_000u32;
        let bits_per_sample = 24u16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * u32::from(block_align);
        let mut fmt = Vec::with_capacity(16);
        fmt.extend_from_slice(&1u16.to_le_bytes());
        fmt.extend_from_slice(&channels.to_le_bytes());
        fmt.extend_from_slice(&sample_rate.to_le_bytes());
        fmt.extend_from_slice(&byte_rate.to_le_bytes());
        fmt.extend_from_slice(&block_align.to_le_bytes());
        fmt.extend_from_slice(&bits_per_sample.to_le_bytes());

        let pcm = vec![0u8; usize::from(block_align) * 960];
        let mut wav = b"RIFF\0\0\0\0WAVE".to_vec();
        append_riff_chunk(&mut wav, b"fmt ", &fmt);
        append_riff_chunk(&mut wav, b"data", &pcm);
        append_riff_chunk(&mut wav, b"LIST", &info);
        let riff_size = (wav.len() - 8) as u32;
        wav[4..8].copy_from_slice(&riff_size.to_le_bytes());
        fs::write(path, wav).unwrap();
    }

    #[test]
    fn malformed_wav_info_uses_core_fallback_without_marking_audio_corrupt() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("malformed-info.wav");
        write_wav_with_lowercase_info_key(&path);

        let lofty_result = Probe::open(&path).unwrap().read();
        assert!(lofty_result.is_err(), "fixture must exercise the fallback");

        let track = extract_metadata(&path);
        assert!(!track.is_corrupt, "{:?}", track.corrupt_reason);
        assert_eq!(track.title, "Fallback Title");
        assert_eq!(track.artist, "Fallback Artist");
        assert_eq!(track.album, "Fallback Album");
        assert_eq!(track.genre.as_deref(), Some("Pop"));
        assert_eq!(track.year, Some(2017));
        assert_eq!(track.track_number, Some(3));
        assert_eq!(track.sample_rate, Some(96_000));
        assert_eq!(track.channels, Some(2));
        assert_eq!(track.bit_depth, Some(24));
        assert!(track.duration_ms > 0);
    }
}

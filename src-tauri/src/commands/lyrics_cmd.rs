use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::State;

use crate::db::queries_tracks::get_track_by_id;
use crate::lyrics::lrc_parser::{load_lyrics_for_track, parse_lrc};
use crate::models::lyrics::{LyricsData, LyricsSource};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
struct LrclibResponse {
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    instrumental: Option<bool>,
}

#[tauri::command]
pub async fn get_track_lyrics(
    track_id: String,
    state: State<'_, AppState>,
) -> Result<Option<LyricsData>, String> {
    let track = {
        let conn = state.db.lock();
        get_track_by_id(&conn, &track_id).map_err(|e| e.to_string())?
    };

    if let Some(t) = track {
        let audio_path = Path::new(&t.path);
        let lyrics = load_lyrics_for_track(t.lyrics.as_deref(), audio_path);
        Ok(lyrics)
    } else {
        Ok(None)
    }
}

/// Fetches lyrics from the free LRCLIB community API.
#[tauri::command]
pub async fn fetch_lrclib_lyrics(
    track_id: String,
    state: State<'_, AppState>,
) -> Result<Option<LyricsData>, String> {
    let track = {
        let conn = state.db.lock();
        get_track_by_id(&conn, &track_id).map_err(|e| e.to_string())?
    };
    let Some(track) = track else {
        return Ok(None);
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Nghe Nhac Pro Max/2.0 (local music player)")
        .build()
        .map_err(|e| format!("Could not initialize LRCLIB client: {e}"))?;
    let duration_secs = (track.duration_ms as f64 / 1000.0).to_string();
    let mut query = vec![
        ("track_name", track.title.as_str()),
        ("artist_name", track.artist.as_str()),
        ("duration", duration_secs.as_str()),
    ];
    if !track.album.trim().is_empty() && track.album != "Unknown Album" {
        query.push(("album_name", track.album.as_str()));
    }

    let payload = client
        .get("https://lrclib.net/api/get")
        .query(&query)
        .send()
        .await
        .map_err(|e| format!("LRCLIB request failed: {e}"))?;
    if !payload.status().is_success() {
        return Ok(None);
    }
    let payload = payload
        .json::<LrclibResponse>()
        .await
        .map_err(|e| format!("Invalid LRCLIB response: {e}"))?;

    if payload.instrumental.unwrap_or(false) {
        return Ok(Some(LyricsData {
            is_synced: false,
            lines: Vec::new(),
            plain_text: "[Instrumental]".to_string(),
            source: LyricsSource::Lrclib,
            romanized: None,
        }));
    }

    if let Some(synced) = payload
        .synced_lyrics
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(Some(parse_lrc(&synced, LyricsSource::Lrclib)));
    }

    let Some(plain_text) = payload
        .plain_lyrics
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    Ok(Some(LyricsData {
        is_synced: false,
        lines: Vec::new(),
        plain_text,
        source: LyricsSource::Lrclib,
        romanized: None,
    }))
}

#[tauri::command]
pub async fn parse_lrc_content(content: String) -> Result<LyricsData, String> {
    Ok(parse_lrc(&content, LyricsSource::Embedded))
}

#[tauri::command]
pub async fn save_romanized_lyrics(
    track_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<LyricsData, String> {
    if content.trim().is_empty() {
        return Err("Romanized lyrics file is empty".to_string());
    }

    let track = {
        let conn = state.db.lock();
        get_track_by_id(&conn, &track_id).map_err(|e| e.to_string())?
    }
    .ok_or_else(|| "Track not found".to_string())?;

    let audio_path = Path::new(&track.path);
    let parent = audio_path
        .parent()
        .ok_or_else(|| "Track path has no parent directory".to_string())?;
    let stem = audio_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Track filename is invalid".to_string())?;
    let romanized_path = parent.join(format!("{stem}.romanized.lrc"));

    fs::write(&romanized_path, content.as_bytes())
        .map_err(|e| format!("Could not save Romanized lyrics: {e}"))?;

    load_lyrics_for_track(track.lyrics.as_deref(), audio_path)
        .ok_or_else(|| "Could not reload Romanized lyrics".to_string())
}

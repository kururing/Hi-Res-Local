use std::fs;
use std::path::Path;
use tauri::State;

use crate::db::queries_tracks::get_track_by_id;
use crate::lyrics::lrc_parser::{load_lyrics_for_track, parse_lrc};
use crate::models::lyrics::{LyricsData, LyricsSource};
use crate::state::AppState;

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

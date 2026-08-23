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

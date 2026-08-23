use tauri::State;

use crate::db::queries_tracks::{
    delete_track as db_delete_track, get_track_by_id as db_get_track_by_id,
    get_tracks as db_get_tracks, set_track_favorite as db_set_favorite,
    set_track_rating as db_set_rating,
};
use crate::models::track::{Track, TrackFilter};
use crate::state::AppState;

#[tauri::command]
pub async fn get_tracks(
    filter: Option<TrackFilter>,
    state: State<'_, AppState>,
) -> Result<Vec<Track>, String> {
    let conn = state.db.lock();
    db_get_tracks(&conn, filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_track_by_id(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Track>, String> {
    let conn = state.db.lock();
    db_get_track_by_id(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_track(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock();
    db_delete_track(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_track_favorite(
    id: String,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock();
    db_set_favorite(&conn, &id, is_favorite).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_track_rating(
    id: String,
    rating: u8,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock();
    db_set_rating(&conn, &id, rating).map_err(|e| e.to_string())
}

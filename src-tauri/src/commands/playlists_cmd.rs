use std::path::Path;
use tauri::State;

use crate::db::queries_playlists::{
    add_tracks_to_playlist as db_add_tracks, create_playlist as db_create_playlist,
    delete_playlist as db_delete_playlist, export_playlist_to_m3u as db_export_m3u,
    get_playlist_with_tracks as db_get_playlist_tracks, get_playlists as db_get_playlists,
    import_playlist_from_m3u as db_import_m3u, remove_tracks_from_playlist as db_remove_tracks,
    reorder_playlist_tracks as db_reorder_tracks, update_playlist as db_update_playlist,
};
use crate::models::playlist::{
    CreatePlaylistInput, Playlist, PlaylistWithTracks, UpdatePlaylistInput,
};
use crate::state::AppState;

#[tauri::command]
pub async fn create_playlist(
    input: CreatePlaylistInput,
    state: State<'_, AppState>,
) -> Result<Playlist, String> {
    let conn = state.db.lock();
    db_create_playlist(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    let conn = state.db.lock();
    db_get_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_playlist(
    id: String,
    state: State<'_, AppState>,
) -> Result<PlaylistWithTracks, String> {
    let conn = state.db.lock();
    db_get_playlist_tracks(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_playlist(
    input: UpdatePlaylistInput,
    state: State<'_, AppState>,
) -> Result<Playlist, String> {
    let conn = state.db.lock();
    db_update_playlist(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_playlist(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock();
    db_delete_playlist(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_tracks_to_playlist(
    playlist_id: String,
    track_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    let mut conn = state.db.lock();
    db_add_tracks(&mut conn, &playlist_id, &track_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_tracks_from_playlist(
    playlist_id: String,
    track_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let mut conn = state.db.lock();
    db_remove_tracks(&mut conn, &playlist_id, &track_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_playlist_tracks(
    playlist_id: String,
    track_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock();
    db_reorder_tracks(&mut conn, &playlist_id, &track_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_playlist_m3u(
    playlist_id: String,
    dest_path: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let conn = state.db.lock();
    db_export_m3u(&conn, &playlist_id, Path::new(&dest_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_playlist_m3u(
    file_path: String,
    custom_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<PlaylistWithTracks, String> {
    let mut conn = state.db.lock();
    db_import_m3u(&mut conn, Path::new(&file_path), custom_name).map_err(|e| e.to_string())
}

use tauri::State;

use crate::db::queries_library::{
    set_album_favorite as db_set_album_favorite, set_artist_favorite as db_set_artist_favorite,
};
use crate::state::AppState;

#[tauri::command]
pub async fn set_artist_favorite(
    artist_name: String,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock();
    db_set_artist_favorite(&conn, &artist_name, is_favorite).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_album_favorite(
    album_title: String,
    artist_name: String,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock();
    db_set_album_favorite(&conn, &album_title, &artist_name, is_favorite).map_err(|e| e.to_string())
}

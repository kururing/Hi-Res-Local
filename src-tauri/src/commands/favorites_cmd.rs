use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::queries_library::{
    get_favorite_album_entries as db_get_favorite_albums,
    get_favorite_artist_names as db_get_favorite_artists,
    set_album_favorite as db_set_album_favorite, set_artist_favorite as db_set_artist_favorite,
};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteAlbumDTO {
    pub album_title: String,
    pub artist_name: String,
}

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

#[tauri::command]
pub async fn get_favorite_artists(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock();
    db_get_favorite_artists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_favorite_albums(
    state: State<'_, AppState>,
) -> Result<Vec<FavoriteAlbumDTO>, String> {
    let conn = state.db.lock();
    let entries = db_get_favorite_albums(&conn).map_err(|e| e.to_string())?;
    Ok(entries
        .into_iter()
        .map(|(album_title, artist_name)| FavoriteAlbumDTO {
            album_title,
            artist_name,
        })
        .collect())
}

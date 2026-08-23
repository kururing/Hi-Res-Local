use tauri::State;

use crate::db::queries_library::{
    get_album_detail as db_get_album_detail, get_albums as db_get_albums,
    get_artist_detail as db_get_artist_detail, get_artists as db_get_artists,
    get_genres as db_get_genres, get_home_feed as db_get_home_feed,
};
use crate::models::album::{AlbumDetail, AlbumSummary};
use crate::models::artist::{ArtistDetail, ArtistSummary};
use crate::models::browse::HomeFeed;
use crate::models::genre::GenreSummary;
use crate::state::AppState;

#[tauri::command]
pub async fn get_home_feed(state: State<'_, AppState>) -> Result<HomeFeed, String> {
    let conn = state.db.lock();
    db_get_home_feed(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_artists(state: State<'_, AppState>) -> Result<Vec<ArtistSummary>, String> {
    let conn = state.db.lock();
    db_get_artists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_artist_detail(
    artist_name: String,
    state: State<'_, AppState>,
) -> Result<ArtistDetail, String> {
    let conn = state.db.lock();
    db_get_artist_detail(&conn, &artist_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_albums(state: State<'_, AppState>) -> Result<Vec<AlbumSummary>, String> {
    let conn = state.db.lock();
    db_get_albums(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_album_detail(
    album_title: String,
    artist_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<AlbumDetail, String> {
    let conn = state.db.lock();
    db_get_album_detail(&conn, &album_title, artist_name.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_genres(state: State<'_, AppState>) -> Result<Vec<GenreSummary>, String> {
    let conn = state.db.lock();
    db_get_genres(&conn).map_err(|e| e.to_string())
}

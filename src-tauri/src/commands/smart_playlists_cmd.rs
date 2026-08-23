use tauri::State;

use crate::db::queries_playlists::build_smart_playlist_query;
use crate::db::queries_tracks::map_row_to_track;
use crate::models::smart_playlist::SmartPlaylistDefinition;
use crate::models::track::Track;
use crate::state::AppState;

#[tauri::command]
pub async fn evaluate_smart_playlist_rules(
    definition: SmartPlaylistDefinition,
    state: State<'_, AppState>,
) -> Result<Vec<Track>, String> {
    let (sql, params_vec) = build_smart_playlist_query(&definition);
    let conn = state.db.lock();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rusqlite_params: Vec<&dyn rusqlite::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(rusqlite_params.as_slice(), map_row_to_track)
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for r in rows {
        tracks.push(r.map_err(|e| e.to_string())?);
    }
    Ok(tracks)
}

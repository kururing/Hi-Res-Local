use tauri::State;

use crate::db::queries_history::{
    clear_play_history as db_clear_history, get_play_history as db_get_history,
    record_play_history as db_record_play,
};
use crate::models::history::{PlayHistoryEntry, RecordPlayInput};
use crate::state::AppState;

#[tauri::command]
pub async fn record_play(
    input: RecordPlayInput,
    state: State<'_, AppState>,
) -> Result<PlayHistoryEntry, String> {
    let conn = state.db.lock();
    db_record_play(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_play_history(
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<PlayHistoryEntry>, String> {
    let conn = state.db.lock();
    db_get_history(&conn, limit.unwrap_or(50), offset.unwrap_or(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_play_history(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.lock();
    db_clear_history(&conn).map_err(|e| e.to_string())
}

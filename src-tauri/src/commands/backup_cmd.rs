use std::path::Path;
use tauri::State;

use crate::db::backup::{
    backup_database as db_backup_database, restore_database as db_restore_database,
};
use crate::state::AppState;

#[tauri::command]
pub async fn backup_database(dest_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock();
    db_backup_database(&conn, Path::new(&dest_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_database(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock();
    db_restore_database(&mut conn, Path::new(&source_path)).map_err(|e| e.to_string())
}

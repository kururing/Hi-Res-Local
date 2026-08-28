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

/// Export the live SQLite database as bytes so the frontend can include it in
/// the user-facing JSON backup alongside browser-only preferences.
#[tauri::command]
pub async fn export_database(state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let path = std::env::temp_dir().join(format!("nghenhac-backup-{}.db", uuid::Uuid::new_v4()));
    {
        let conn = state.db.lock();
        db_backup_database(&conn, &path).map_err(|e| e.to_string())?;
    }
    let result = std::fs::read(&path).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&path);
    result
}

#[tauri::command]
pub async fn import_database(data: Vec<u8>, state: State<'_, AppState>) -> Result<(), String> {
    if data.is_empty() {
        return Err("Backup database is empty".to_string());
    }
    let path = std::env::temp_dir().join(format!("nghenhac-restore-{}.db", uuid::Uuid::new_v4()));
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    let result = {
        let mut conn = state.db.lock();
        db_restore_database(&mut conn, &path).map_err(|e| e.to_string())
    };
    let _ = std::fs::remove_file(&path);
    result
}

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::queries_library::{
    add_library_root as db_add_root, get_library_roots as db_get_roots,
    remove_library_root as db_remove_root, set_root_active as db_set_active,
};
use crate::models::duplicate::DuplicateGroup;
use crate::models::settings::LibraryRoot;
use crate::scanner::scan_library_roots;
use crate::state::AppState;

#[tauri::command]
pub async fn add_library_root(
    path: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<LibraryRoot, String> {
    let conn = state.db.lock();
    db_add_root(&conn, &path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_library_roots(state: State<'_, AppState>) -> Result<Vec<LibraryRoot>, String> {
    let conn = state.db.lock();
    db_get_roots(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_library_root(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock();
    db_remove_root(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_library_root_active(
    id: String,
    is_active: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock();
    db_set_active(&conn, &id, is_active).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_library(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let roots = {
        let conn = state.db.lock();
        let list = db_get_roots(&conn).map_err(|e| e.to_string())?;
        list.into_iter()
            .filter(|r| r.is_active)
            .map(|r| PathBuf::from(r.path))
            .collect::<Vec<PathBuf>>()
    };

    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || scan_library_roots(db, &roots, Some(&app_handle)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_duplicate_groups(
    state: State<'_, AppState>,
) -> Result<Vec<DuplicateGroup>, String> {
    let conn = state.db.lock();
    db_get_duplicates(&conn).map_err(|e| e.to_string())
}

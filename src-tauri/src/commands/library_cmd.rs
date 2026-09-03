use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::queries_library::{
    add_library_root as db_add_root, get_library_root_by_path, get_library_roots as db_get_roots,
    remove_library_root_with_tracks as db_remove_root_with_tracks,
    set_root_active as db_set_active,
};
use crate::db::queries_settings::set_setting;
use crate::db::queries_tracks::get_duplicate_groups as db_get_duplicates;
use crate::models::duplicate::DuplicateGroup;
use crate::models::settings::LibraryRoot;
use crate::scanner::scan_library_roots;
use crate::scanner::watcher::LibraryWatcher;
use crate::state::AppState;

#[tauri::command]
pub async fn add_library_root(
    path: String,
    name: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<LibraryRoot, String> {
    crate::fs_guard::assert_new_library_root(&path, &state.allowed_fs_paths)?;
    let root = {
        let conn = state.db.lock();
        db_add_root(&conn, &path, &name).map_err(|e| e.to_string())?
    };
    if let Some(watcher) = crate::sync_util::recover_mutex(&state.watcher).as_mut() {
        watcher
            .watch_path(&PathBuf::from(&root.path))
            .map_err(|e| e.to_string())?;
    } else {
        let watching_enabled = {
            let conn = state.db.lock();
            crate::db::queries_settings::get_setting(&conn, "watch_directories")
                .map_err(|e| e.to_string())?
                .map(|value| value == "1" || value == "true")
                .unwrap_or(true)
        };
        if watching_enabled {
            let mut watcher = LibraryWatcher::new(Arc::clone(&state.db), Some(app_handle))
                .map_err(|e| e.to_string())?;
            watcher
                .watch_path(&PathBuf::from(&root.path))
                .map_err(|e| e.to_string())?;
            *crate::sync_util::recover_mutex(&state.watcher) = Some(watcher);
        }
    }
    Ok(root)
}

#[tauri::command]
pub async fn get_library_roots(state: State<'_, AppState>) -> Result<Vec<LibraryRoot>, String> {
    let conn = state.db.lock();
    db_get_roots(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_library_root(
    id: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let root = {
        let conn = state.db.lock();
        db_get_roots(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|root| root.id == id)
    };
    if let (Some(root), Some(watcher)) = (
        root.as_ref(),
        crate::sync_util::recover_mutex(&state.watcher).as_mut(),
    ) {
        let _ = watcher.unwatch_path(&PathBuf::from(&root.path));
    }
    let Some(root) = root else {
        return Ok(false);
    };
    let mut conn = state.db.lock();
    let removed =
        db_remove_root_with_tracks(&mut conn, &id, &root.path).map_err(|e| e.to_string())?;
    drop(conn);
    if removed {
        use tauri::Emitter;
        let _ = app_handle.emit(
            "library://scan_finished",
            serde_json::json!({ "total": 0, "success": true }),
        );
    }
    Ok(removed)
}

#[tauri::command]
pub async fn remove_library_root_by_path(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let root = {
        let conn = state.db.lock();
        get_library_root_by_path(&conn, &path).map_err(|e| e.to_string())?
    };
    match root {
        Some(root) => remove_library_root(root.id, app_handle, state).await,
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn set_directory_watching(
    enabled: bool,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let conn = state.db.lock();
        set_setting(&conn, "watch_directories", if enabled { "1" } else { "0" })
            .map_err(|e| e.to_string())?;
    }
    let mut slot = crate::sync_util::recover_mutex(&state.watcher);
    if !enabled {
        *slot = None;
        return Ok(());
    }
    if slot.is_none() {
        let roots = {
            let conn = state.db.lock();
            db_get_roots(&conn).map_err(|e| e.to_string())?
        };
        let mut watcher = LibraryWatcher::new(Arc::clone(&state.db), Some(app_handle))
            .map_err(|e| e.to_string())?;
        for root in roots.into_iter().filter(|root| root.is_active) {
            watcher
                .watch_path(&PathBuf::from(root.path))
                .map_err(|e| e.to_string())?;
        }
        *slot = Some(watcher);
    }
    Ok(())
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

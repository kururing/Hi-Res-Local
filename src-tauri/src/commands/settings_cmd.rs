use tauri::{AppHandle, State};

use crate::db::queries_settings::{
    get_app_settings as db_get_settings, save_app_settings as db_save_settings,
};
use crate::models::settings::AppSettings;
use crate::state::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock();
    db_get_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock();
    db_save_settings(&conn, &settings).map_err(|e| e.to_string())
}

/// Exit the whole application, including the tray event loop.
#[tauri::command]
pub fn quit_app(app_handle: AppHandle) {
    app_handle.exit(0);
}

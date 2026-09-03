use tauri::{AppHandle, State};

use crate::db::queries_settings::{
    get_app_settings as db_get_settings, get_saved_playback_state as db_get_saved_playback_state,
    save_app_settings as db_save_settings, save_playback_state, SavedPlaybackState,
};
use crate::models::settings::AppSettings;
use crate::state::AppState;

#[tauri::command]
pub async fn get_audio_toml_patch() -> Result<nnpm_audio_core::config::SettingsPatch, String> {
    Ok(crate::audio::toml_config::load_settings_patch())
}

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

#[tauri::command]
pub async fn get_saved_playback_state(
    state: State<'_, AppState>,
) -> Result<Option<SavedPlaybackState>, String> {
    let conn = state.db.lock();
    db_get_saved_playback_state(&conn).map_err(|e| e.to_string())
}

/// Exit the whole application, including the tray event loop.
#[tauri::command]
pub fn quit_app(app_handle: AppHandle, state: State<'_, AppState>) {
    let snapshot = state.player.get_snapshot();
    if let Some(track) = snapshot.current_track {
        let conn = state.db.lock();
        if let Err(err) = save_playback_state(&conn, &track.id, snapshot.progress.position_ms) {
            tracing::warn!("Failed to persist playback position before exit: {err}");
        }
    }
    app_handle.exit(0);
}

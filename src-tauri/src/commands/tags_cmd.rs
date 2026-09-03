use tauri::State;

use crate::models::track::{Track, TrackUpdateTags};
use crate::state::AppState;
use crate::tags::editor::update_tags_and_save;
use crate::db::queries_tracks::get_track_by_id;

#[tauri::command]
pub async fn update_track_tags(
    update: TrackUpdateTags,
    state: State<'_, AppState>,
) -> Result<Track, String> {
    {
        let conn = state.db.lock();
        let track = get_track_by_id(&conn, &update.id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track not found: {}", update.id))?;
        crate::fs_guard::assert_media_path(&conn, &state.allowed_fs_paths, &track.path)?;
    }
    update_tags_and_save(&state.db, &update).map_err(|e| e.to_string())
}

use tauri::State;

use crate::models::track::{Track, TrackUpdateTags};
use crate::state::AppState;
use crate::tags::editor::update_tags_and_save;

#[tauri::command]
pub async fn update_track_tags(
    update: TrackUpdateTags,
    state: State<'_, AppState>,
) -> Result<Track, String> {
    update_tags_and_save(&state.db, &update).map_err(|e| e.to_string())
}

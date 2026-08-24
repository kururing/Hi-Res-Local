use tauri::State;

use crate::discord::DiscordActivity;
use crate::state::AppState;

#[tauri::command]
pub async fn set_discord_presence(
    enabled: bool,
    activity: Option<DiscordActivity>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.discord_presence.set(enabled, activity.as_ref())
}

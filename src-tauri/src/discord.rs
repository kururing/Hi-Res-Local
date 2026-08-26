use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;

const CLIENT_ID_ENV: &str = "NGHENHAC_DISCORD_CLIENT_ID";
const DEFAULT_CLIENT_ID: &str = "1541415350602702870";

#[derive(Debug, Clone, Deserialize)]
pub struct DiscordActivity {
    pub title: String,
    pub artist: String,
    pub position_secs: Option<f64>,
    pub duration_secs: Option<f64>,
}

pub struct DiscordPresence {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl DiscordPresence {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }

    pub fn set(&self, enabled: bool, now_playing: Option<&DiscordActivity>) -> Result<(), String> {
        let mut client = self
            .client
            .lock()
            .map_err(|_| "Discord Rich Presence state is unavailable".to_string())?;

        if !enabled {
            if let Some(mut connected) = client.take() {
                let _ = connected.clear_activity();
                let _ = connected.close();
            }
            return Ok(());
        }

        if client.is_none() {
            let client_id = discord_client_id();
            let mut connected = DiscordIpcClient::new(&client_id)
                .map_err(|error| format!("Could not initialize Discord: {error}"))?;
            connected
                .connect()
                .map_err(|error| format!("Could not connect to Discord: {error}"))?;
            *client = Some(connected);
        }

        let connected = client
            .as_mut()
            .ok_or_else(|| "Discord Rich Presence is unavailable".to_string())?;

        let update_result = match now_playing {
            Some(track) => {
                let title = discord_text(&track.title);
                let artist = discord_text(&track.artist);
                let timestamps = discord_timestamps(track);
                let mut activity = activity::Activity::new()
                    .activity_type(activity::ActivityType::Listening)
                    .details(&title)
                    .state(&artist);
                if let Some((start, end)) = timestamps {
                    activity =
                        activity.timestamps(activity::Timestamps::new().start(start).end(end));
                }
                connected
                    .set_activity(activity)
                    .map_err(|error| format!("Could not update Discord activity: {error}"))
            }
            None => connected
                .clear_activity()
                .map_err(|error| format!("Could not clear Discord activity: {error}")),
        };

        if update_result.is_err() {
            if let Some(mut disconnected) = client.take() {
                let _ = disconnected.close();
            }
        }

        update_result
    }
}

fn discord_timestamps(track: &DiscordActivity) -> Option<(i64, i64)> {
    let duration = track.duration_secs?;
    let position = track.position_secs.unwrap_or(0.0);
    if !duration.is_finite() || !position.is_finite() || duration <= 0.0 {
        return None;
    }

    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let clamped_position = position.clamp(0.0, duration);
    let start = now.saturating_sub(clamped_position.floor() as i64);
    let end = start.saturating_add(duration.ceil() as i64);
    Some((start, end))
}

fn discord_client_id() -> String {
    option_env!("NGHENHAC_DISCORD_CLIENT_ID")
        .map(str::to_owned)
        .or_else(|| std::env::var(CLIENT_ID_ENV).ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_owned())
}

fn discord_text(value: &str) -> String {
    value.trim().chars().take(128).collect()
}

impl Default for DiscordPresence {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_keep_the_track_duration_and_clamp_position() {
        let activity = DiscordActivity {
            title: "Song".into(),
            artist: "Artist".into(),
            position_secs: Some(999.0),
            duration_secs: Some(180.0),
        };
        let (start, end) = discord_timestamps(&activity).expect("timestamps");
        assert_eq!(end - start, 180);
        assert!(
            end <= SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
                + 1
        );
    }

    #[test]
    fn timestamps_are_omitted_without_a_valid_duration() {
        let activity = DiscordActivity {
            title: "Song".into(),
            artist: "Artist".into(),
            position_secs: Some(10.0),
            duration_secs: Some(0.0),
        };
        assert!(discord_timestamps(&activity).is_none());
    }
}

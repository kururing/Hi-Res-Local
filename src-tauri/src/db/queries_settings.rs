use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::queries_library::get_library_roots;
use crate::error::AppResult;
use crate::models::settings::AppSettings;

const LAST_PLAYBACK_STATE_KEY: &str = "last_playback_state_v3";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SavedPlaybackState {
    pub track_id: String,
    pub position_ms: u64,
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        r#"
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        "#,
        params![key, value, now],
    )?;
    Ok(())
}

pub fn get_saved_playback_state(conn: &Connection) -> AppResult<Option<SavedPlaybackState>> {
    get_setting(conn, LAST_PLAYBACK_STATE_KEY)?
        .map(|value| serde_json::from_str(&value).map_err(Into::into))
        .transpose()
}

pub fn save_playback_state(conn: &Connection, track_id: &str, position_ms: u64) -> AppResult<()> {
    let value = serde_json::to_string(&SavedPlaybackState {
        track_id: track_id.to_string(),
        position_ms,
    })?;
    set_setting(conn, LAST_PLAYBACK_STATE_KEY, &value)
}

pub fn get_app_settings(conn: &Connection) -> AppResult<AppSettings> {
    let library_roots = get_library_roots(conn)?;
    let theme = get_setting(conn, "theme")?.unwrap_or_else(|| "system".to_string());
    let language = get_setting(conn, "language")?.unwrap_or_else(|| "vi".to_string());
    let output_device = get_setting(conn, "output_device")?;
    let auto_scan = get_setting(conn, "auto_scan_on_startup")?
        .map(|v| v == "true" || v == "1")
        .unwrap_or(true);
    let watch_dirs = get_setting(conn, "watch_directories")?
        .map(|v| v == "true" || v == "1")
        .unwrap_or(true);
    let crossfade_ms = get_setting(conn, "crossfade_duration_ms")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let exclusive_audio = get_setting(conn, "exclusive_audio_mode")?
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let volume = get_setting(conn, "volume")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(1.0);
    let dsd_output_mode =
        get_setting(conn, "dsd_output_mode")?.unwrap_or_else(|| "native_dsd".into());
    let audio_backend = get_setting(conn, "audio_backend")?.unwrap_or_else(|| "shared".into());
    let asio_driver_id = get_setting(conn, "asio_driver_id")?;

    Ok(AppSettings {
        library_roots,
        theme,
        language,
        output_device,
        auto_scan_on_startup: auto_scan,
        watch_directories: watch_dirs,
        crossfade_duration_ms: crossfade_ms,
        exclusive_audio_mode: exclusive_audio,
        volume,
        dsd_output_mode,
        audio_backend,
        asio_driver_id,
    })
}

pub fn save_app_settings(conn: &Connection, settings: &AppSettings) -> AppResult<()> {
    set_setting(conn, "theme", &settings.theme)?;
    set_setting(conn, "language", &settings.language)?;
    if let Some(ref dev) = settings.output_device {
        set_setting(conn, "output_device", dev)?;
    } else {
        conn.execute("DELETE FROM app_settings WHERE key = 'output_device'", [])?;
    }
    set_setting(
        conn,
        "auto_scan_on_startup",
        if settings.auto_scan_on_startup {
            "1"
        } else {
            "0"
        },
    )?;
    set_setting(
        conn,
        "watch_directories",
        if settings.watch_directories { "1" } else { "0" },
    )?;
    set_setting(
        conn,
        "crossfade_duration_ms",
        &settings.crossfade_duration_ms.to_string(),
    )?;
    set_setting(
        conn,
        "exclusive_audio_mode",
        if settings.exclusive_audio_mode {
            "1"
        } else {
            "0"
        },
    )?;
    set_setting(conn, "volume", &settings.volume.to_string())?;
    set_setting(conn, "dsd_output_mode", &settings.dsd_output_mode)?;
    set_setting(conn, "audio_backend", &settings.audio_backend)?;
    if let Some(driver) = &settings.asio_driver_id {
        set_setting(conn, "asio_driver_id", driver)?;
    } else {
        conn.execute("DELETE FROM app_settings WHERE key = 'asio_driver_id'", [])?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_playback_round_trips_as_one_atomic_setting() {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .expect("settings table");

        save_playback_state(&conn, "track-42", 73_500).expect("save playback state");

        assert_eq!(
            get_saved_playback_state(&conn).expect("load playback state"),
            Some(SavedPlaybackState {
                track_id: "track-42".to_string(),
                position_ms: 73_500,
            })
        );
    }
}

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::audio::adapters::ExclusiveAudioAdapter;
use crate::audio::dto::{
    AudioDeviceDTO, AudioTrack, CrossfadeConfig, CrossfadeCurve, EqConfig, EqPreset,
    PlayerSnapshot, RepeatMode, ReplayGainConfig, ReplayGainMode, SystemAudioState,
};
use crate::db::queries_tracks::{
    get_track_by_id as db_get_track_by_id, get_tracks_summary as db_get_tracks_summary,
};
use crate::models::track::Track;
use crate::scanner::scan_library_roots;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioTrackInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub track_number: Option<u32>,
    #[serde(default)]
    pub year: Option<u32>,
    #[serde(default)]
    pub genre: Option<String>,
}

impl AudioTrackInput {
    pub fn into_audio_track(self) -> AudioTrack {
        let path = self.path.unwrap_or_default();
        let id = self.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let duration_ms = self
            .duration_ms
            .unwrap_or_else(|| (self.duration.unwrap_or(0.0) * 1000.0) as u64);
        let title = self.title.unwrap_or_else(|| {
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown Title")
                .to_string()
        });
        let artist = self.artist.unwrap_or_else(|| "Unknown Artist".to_string());
        let album = self.album.unwrap_or_else(|| "Unknown Album".to_string());

        AudioTrack {
            id,
            path,
            title,
            artist,
            album,
            duration_ms,
            track_number: self.track_number,
            year: self.year,
            genre: self.genre,
            replay_gain: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioCapabilitiesDTO {
    pub exclusive_mode_supported: bool,
    pub media_controls_supported: bool,
    pub gapless_supported: bool,
    pub replay_gain_supported: bool,
    pub equalizer_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStatsDTO {
    pub total_tracks: u32,
    pub total_artists: u32,
    pub total_albums: u32,
    pub total_duration_secs: u64,
    pub total_size_bytes: Option<u64>,
}

// ---------------- Playback Commands ----------------

#[tauri::command]
pub async fn play_track(
    track: Option<AudioTrackInput>,
    track_id: Option<String>,
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_track = if let Some(input) = track {
        input.into_audio_track()
    } else if let Some(id) = track_id {
        let conn = state.db.lock();
        let db_tr = db_get_track_by_id(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track id not found: {}", id))?;
        AudioTrack {
            id: db_tr.id,
            path: db_tr.path,
            title: db_tr.title,
            artist: db_tr.artist,
            album: db_tr.album,
            duration_ms: db_tr.duration_ms,
            track_number: db_tr.track_number,
            year: db_tr.year,
            genre: db_tr.genre,
            replay_gain: None,
        }
    } else if let Some(p) = path {
        let title = std::path::Path::new(&p)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown Title")
            .to_string();
        AudioTrack {
            id: uuid::Uuid::new_v4().to_string(),
            path: p,
            title,
            artist: "Unknown Artist".to_string(),
            album: "Unknown Album".to_string(),
            duration_ms: 0,
            track_number: None,
            year: None,
            genre: None,
            replay_gain: None,
        }
    } else {
        return state.player.play_current().map_err(|e| e.to_string());
    };

    state
        .player
        .play_track(audio_track)
        .map_err(|e| e.to_string())
}

/// Replace the backend queue with `tracks` and start playing at `start_index`.
/// Keeps queue/shuffle/gapless ownership in the backend.
#[tauri::command]
pub async fn play_queue(
    tracks: Vec<AudioTrackInput>,
    start_index: Option<usize>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_tracks: Vec<AudioTrack> = tracks.into_iter().map(|t| t.into_audio_track()).collect();
    state
        .player
        .play_queue(audio_tracks, start_index.unwrap_or(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn play_current(state: State<'_, AppState>) -> Result<(), String> {
    state.player.play_current().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pause_playback(state: State<'_, AppState>) -> Result<(), String> {
    state.player.pause().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resume_playback(state: State<'_, AppState>) -> Result<(), String> {
    state.player.resume().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_playback(state: State<'_, AppState>) -> Result<(), String> {
    state.player.stop().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_play_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.player.toggle_play_pause().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn seek_playback(
    position_secs: Option<f64>,
    position_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pos = position_ms.unwrap_or_else(|| (position_secs.unwrap_or(0.0) * 1000.0) as u64);
    state.player.seek(pos).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn next_track(state: State<'_, AppState>) -> Result<(), String> {
    state.player.next().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn previous_track(state: State<'_, AppState>) -> Result<(), String> {
    state.player.previous().map_err(|e| e.to_string())
}

// ---------------- Volume & Loop & Shuffle ----------------

#[tauri::command]
pub async fn set_volume(volume: f32, state: State<'_, AppState>) -> Result<(), String> {
    state.player.set_volume(volume).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_muted(muted: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.player.set_muted(muted).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_mute(state: State<'_, AppState>) -> Result<bool, String> {
    state.player.toggle_mute().map_err(|e| e.to_string())?;
    Ok(state.player.get_snapshot().is_muted)
}

#[tauri::command]
pub async fn get_system_audio_state(
    state: State<'_, AppState>,
) -> Result<SystemAudioState, String> {
    state
        .player
        .get_system_audio_state()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_loop_mode(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let repeat = match mode.to_lowercase().as_str() {
        "track" | "one" => RepeatMode::One,
        "playlist" | "all" => RepeatMode::All,
        _ => RepeatMode::Off,
    };
    state
        .player
        .set_repeat_mode(repeat)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_repeat_mode(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    set_loop_mode(mode, state).await
}

#[tauri::command]
pub async fn set_shuffle(
    shuffle: Option<bool>,
    enabled: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let flag = shuffle.or(enabled).unwrap_or(false);
    state.player.set_shuffle(flag).map_err(|e| e.to_string())
}

// ---------------- Status & Snapshot ----------------

#[tauri::command]
pub async fn get_playback_status(state: State<'_, AppState>) -> Result<PlayerSnapshot, String> {
    Ok(state.player.get_snapshot())
}

#[tauri::command]
pub async fn get_player_snapshot(state: State<'_, AppState>) -> Result<PlayerSnapshot, String> {
    Ok(state.player.get_snapshot())
}

// ---------------- Audio Devices & Hardware ----------------

#[tauri::command]
pub async fn get_audio_output_devices(
    state: State<'_, AppState>,
) -> Result<Vec<AudioDeviceDTO>, String> {
    state.player.enumerate_devices().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_audio_output_device(
    device_id: Option<String>,
    device_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let target = device_name.or(device_id);
    state
        .player
        .select_output_device(target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_bit_perfect(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    state
        .player
        .set_bit_perfect(enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_exclusive_mode(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    // Keep the adapter flag in sync for capability/legacy readers, but Exclusive
    // I/O is owned exclusively by the Player / WASAPI control plane.
    {
        let mut adapter = crate::sync_util::recover_mutex(&state.exclusive_adapter);
        let _ = adapter.set_exclusive(enabled);
    }
    state
        .player
        .set_exclusive_mode(enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_audio_capabilities(
    state: State<'_, AppState>,
) -> Result<AudioCapabilitiesDTO, String> {
    #[cfg(windows)]
    let excl = {
        use crate::audio::wasapi::{FormatNegotiator, WasapiDeviceManager};
        let _ = &state;
        let mgr = WasapiDeviceManager::new();
        match mgr.get_active_device() {
            Ok(device) => FormatNegotiator::exclusive_supported(&device),
            Err(_) => false,
        }
    };
    #[cfg(not(windows))]
    let excl = crate::sync_util::recover_mutex(&state.exclusive_adapter).is_supported();
    let smtc = false; // Fallback adapter reports honest capability (no fake SMTC)
    Ok(AudioCapabilitiesDTO {
        exclusive_mode_supported: excl,
        media_controls_supported: smtc,
        gapless_supported: true,
        replay_gain_supported: true,
        equalizer_supported: true,
    })
}

// ---------------- DSP Settings ----------------

#[tauri::command]
pub async fn set_equalizer(
    enabled: bool,
    gains: Option<Vec<f32>>,
    preset: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut bands = EqConfig::default_10_bands();
    if let Some(gain_list) = gains {
        for (i, &g) in gain_list.iter().enumerate().take(bands.len()) {
            bands[i].gain_db = g;
        }
    }

    let eq_preset = match preset.as_deref() {
        Some("bass") | Some("bass_boost") => EqPreset::BassBoost,
        Some("treble") | Some("treble_boost") => EqPreset::TrebleBoost,
        Some("vocal") => EqPreset::Vocal,
        Some("rock") => EqPreset::Rock,
        Some("pop") => EqPreset::Pop,
        Some("jazz") => EqPreset::Jazz,
        Some("electronic") => EqPreset::Electronic,
        Some("classical") => EqPreset::Classical,
        Some("acoustic") => EqPreset::Acoustic,
        Some("custom") => EqPreset::Custom,
        _ => EqPreset::Flat,
    };

    let config = EqConfig {
        enabled,
        preset: eq_preset,
        bands,
    };

    state
        .player
        .set_eq_config(config)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_crossfade(
    enabled: Option<bool>,
    duration_secs: Option<f64>,
    duration_ms: Option<u64>,
    curve: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dur_ms = duration_ms.unwrap_or_else(|| (duration_secs.unwrap_or(2.5) * 1000.0) as u64);
    let cross_curve = match curve.as_deref() {
        Some("linear") => CrossfadeCurve::Linear,
        _ => CrossfadeCurve::EqualPower,
    };

    let config = CrossfadeConfig {
        enabled: enabled.unwrap_or(dur_ms > 0),
        duration_ms: dur_ms,
        curve: cross_curve,
    };

    state
        .player
        .set_crossfade_config(config)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_replay_gain(
    mode: String,
    preamp_db: Option<f32>,
    prevent_clipping: Option<bool>,
    fallback_gain_db: Option<f32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let rg_mode = match mode.to_lowercase().as_str() {
        "track" => ReplayGainMode::Track,
        "album" => ReplayGainMode::Album,
        _ => ReplayGainMode::Off,
    };

    let config = ReplayGainConfig {
        mode: rg_mode,
        preamp_db: preamp_db.unwrap_or(0.0),
        prevent_clipping: prevent_clipping.unwrap_or(true),
        fallback_gain_db: fallback_gain_db.unwrap_or(0.0),
    };

    state
        .player
        .set_replay_gain_config(config)
        .map_err(|e| e.to_string())
}

// ---------------- Queue Commands ----------------

#[tauri::command]
pub async fn queue_add(
    tracks: Vec<AudioTrackInput>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_tracks: Vec<AudioTrack> = tracks.into_iter().map(|t| t.into_audio_track()).collect();
    state
        .player
        .queue_add(audio_tracks)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_play_next(
    track: AudioTrackInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .player
        .queue_play_next(track.into_audio_track())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_remove(index: usize, state: State<'_, AppState>) -> Result<(), String> {
    state.player.queue_remove(index).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_reorder(
    from: usize,
    to: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .player
        .queue_reorder(from, to)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.player.queue_clear().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_clear_upcoming(state: State<'_, AppState>) -> Result<(), String> {
    state
        .player
        .queue_clear_upcoming()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn queue_set_index(index: usize, state: State<'_, AppState>) -> Result<(), String> {
    state
        .player
        .queue_set_index(index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_queue(state: State<'_, AppState>) -> Result<Vec<AudioTrack>, String> {
    Ok(state.player.get_snapshot().queue)
}

// ---------------- Native Dialogs ----------------

#[tauri::command]
pub async fn open_folder_dialog() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_files_dialog() -> Result<Option<Vec<String>>, String> {
    let files = rfd::FileDialog::new()
        .add_filter(
            "Audio Files",
            &[
                "mp3", "flac", "wav", "ogg", "m4a", "aac", "alac", "opus", "aiff",
            ],
        )
        .pick_files();
    Ok(files.map(|list| {
        list.into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    }))
}

// ---------------- Extended Library Helper Commands ----------------

#[tauri::command]
pub async fn get_all_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let conn = state.db.lock();
    // Summary query: lyrics are excluded and loaded on demand via get_track_lyrics.
    db_get_tracks_summary(&conn, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_library_stats(state: State<'_, AppState>) -> Result<LibraryStatsDTO, String> {
    let conn = state.db.lock();
    let (total_tracks, total_duration_ms, total_size): (i64, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(id), SUM(duration_ms), SUM(file_size) FROM tracks WHERE is_corrupt = 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, None, None));

    let total_albums: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT album) FROM tracks WHERE is_corrupt = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_artists: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT COALESCE(NULLIF(album_artist, ''), artist)) FROM tracks WHERE is_corrupt = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(LibraryStatsDTO {
        total_tracks: total_tracks as u32,
        total_artists: total_artists as u32,
        total_albums: total_albums as u32,
        total_duration_secs: (total_duration_ms.unwrap_or(0) / 1000) as u64,
        total_size_bytes: total_size.map(|s| s as u64),
    })
}

#[tauri::command]
pub async fn scan_directory(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Track>, String> {
    let root_path = PathBuf::from(&path);
    let db = Arc::clone(&state.db);
    let roots = vec![root_path];

    tokio::task::spawn_blocking(move || scan_library_roots(db, &roots, Some(&app_handle)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let conn = state.db.lock();
    db_get_tracks_summary(&conn, None).map_err(|e| e.to_string())
}

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use crate::audio::adapters::ExclusiveAudioAdapter;
use crate::audio::dto::{
    AsioDriverDTO, AudioBackend, AudioDeviceDTO, AudioTrack, CrossfadeConfig, CrossfadeCurve,
    DsdOutputMode, DsdRate, EngineStatus, EqConfig, EqPreset, PlaybackMode, PlayerSnapshot,
    RepeatMode, ReplayGainConfig, ReplayGainMode, SystemAudioState,
};
use crate::db::queries_settings::save_playback_state;
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
    pub stream_url: Option<String>,
    #[serde(default)]
    pub stream_expires_at: Option<String>,
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
            stream_url: self
                .stream_url
                .filter(|url| crate::audio::http_input::is_http_stream_url(url)),
            stream_expires_at: self
                .stream_expires_at
                .filter(|value| !value.trim().is_empty()),
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
    pub asio_supported: bool,
    pub native_dsd_supported: bool,
    pub dsd_rates: Vec<DsdRate>,
    pub dop_supported: bool,
    pub dop_rates: Vec<DsdRate>,
    pub asio_drivers_present: bool,
}

/// Combine probed hardware facts into the capability DTO the UI gates on.
/// ASIO / Native DSD never follow `SDK_AVAILABLE` alone — empty driver lists
/// disable those options even when the SDK was compiled in.
pub fn build_audio_capabilities(
    exclusive_mode_supported: bool,
    drivers: &[AsioDriverDTO],
    dop_rates: Vec<DsdRate>,
) -> AudioCapabilitiesDTO {
    let mut dsd_rates = Vec::new();
    for driver in drivers {
        for rate in &driver.dsd_rates {
            if !dsd_rates.contains(rate) {
                dsd_rates.push(*rate);
            }
        }
    }
    let asio_drivers_present = !drivers.is_empty();
    let native_dsd_supported = drivers.iter().any(|driver| driver.native_dsd_supported);
    AudioCapabilitiesDTO {
        exclusive_mode_supported,
        media_controls_supported: false,
        gapless_supported: true,
        replay_gain_supported: true,
        equalizer_supported: true,
        asio_supported: asio_drivers_present,
        native_dsd_supported,
        dsd_rates,
        dop_supported: !dop_rates.is_empty(),
        dop_rates,
        asio_drivers_present,
    }
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

fn assert_playable_track(state: &AppState, track: &AudioTrack) -> Result<(), String> {
    if track
        .stream_url
        .as_ref()
        .is_some_and(|url| !url.trim().is_empty())
        && track.path.trim().is_empty()
    {
        let url = track.stream_url.as_deref().unwrap_or_default();
        return crate::audio::http_input::validate_http_stream_url(url)
            .map_err(|error| error.to_string());
    }
    let conn = state.db.lock();
    crate::fs_guard::assert_media_path(&conn, &state.allowed_fs_paths, &track.path)
}

fn persist_player_position(state: &AppState, position_override_ms: Option<u64>) {
    let snapshot = state.player.get_snapshot();
    let Some(track) = snapshot.current_track else {
        return;
    };
    let position_ms = position_override_ms.unwrap_or(snapshot.progress.position_ms);
    let conn = state.db.lock();
    if let Err(err) = save_playback_state(&conn, &track.id, position_ms) {
        tracing::warn!("Failed to persist playback position: {err}");
    }
}

#[tauri::command]
pub async fn play_track(
    track: Option<AudioTrackInput>,
    track_id: Option<String>,
    path: Option<String>,
    start_position_secs: Option<f64>,
    start_position_ms: Option<u64>,
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
            stream_url: None,
            stream_expires_at: None,
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
            stream_url: None,
            stream_expires_at: None,
        }
    } else {
        return state.player.play_current().map_err(|e| e.to_string());
    };

    assert_playable_track(&state, &audio_track)?;
    let start_position_ms = start_position_ms
        .unwrap_or_else(|| (start_position_secs.unwrap_or(0.0).max(0.0) * 1000.0) as u64);
    state
        .player
        .play_track_at(audio_track, start_position_ms)
        .map_err(|e| e.to_string())
}

/// Replace the backend queue with `tracks` and start playing at `start_index`
/// from the requested resume position.
/// Keeps queue/shuffle/gapless ownership in the backend.
#[tauri::command]
pub async fn play_queue(
    tracks: Vec<AudioTrackInput>,
    start_index: Option<usize>,
    start_position_secs: Option<f64>,
    start_position_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_tracks: Vec<AudioTrack> = tracks.into_iter().map(|t| t.into_audio_track()).collect();
    for track in &audio_tracks {
        assert_playable_track(&state, track)?;
    }
    let start_position_ms = start_position_ms
        .unwrap_or_else(|| (start_position_secs.unwrap_or(0.0).max(0.0) * 1000.0) as u64);
    state
        .player
        .play_queue_at(audio_tracks, start_index.unwrap_or(0), start_position_ms)
        .map_err(|e| e.to_string())
}

/// Replace queue ordering while playback continues from the current track.
#[tauri::command]
pub async fn queue_replace(
    tracks: Vec<AudioTrackInput>,
    current_index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_tracks: Vec<AudioTrack> = tracks.into_iter().map(|t| t.into_audio_track()).collect();
    for track in &audio_tracks {
        assert_playable_track(&state, track)?;
    }
    state
        .player
        .queue_replace(audio_tracks, current_index)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn play_current(state: State<'_, AppState>) -> Result<(), String> {
    state.player.play_current().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pause_playback(state: State<'_, AppState>) -> Result<(), String> {
    state.player.pause().map_err(|e| e.to_string())?;
    persist_player_position(&state, None);
    Ok(())
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
    state.player.seek(pos).map_err(|e| e.to_string())?;
    persist_player_position(&state, Some(pos));
    Ok(())
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
pub async fn get_asio_drivers() -> Result<Vec<AsioDriverDTO>, String> {
    Ok(crate::audio::asio::drivers_snapshot())
}

#[tauri::command]
pub async fn apply_playback_mode(
    mode: PlaybackMode,
    device_id: Option<String>,
    backend: Option<AudioBackend>,
    dsd_transport: Option<DsdOutputMode>,
    asio_driver_id: Option<String>,
    mqa_passthrough: Option<bool>,
    state: State<'_, AppState>,
) -> Result<EngineStatus, String> {
    state
        .player
        .apply_playback_mode(
            mode,
            device_id,
            backend,
            dsd_transport,
            asio_driver_id,
            mqa_passthrough,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_audio_backend(
    backend: AudioBackend,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match backend {
        AudioBackend::Shared => state
            .player
            .set_exclusive_mode(false)
            .map_err(|e| e.to_string()),
        AudioBackend::WasapiExclusive => state
            .player
            .set_exclusive_mode(true)
            .map_err(|e| e.to_string()),
        AudioBackend::Asio => state
            .player
            .apply_playback_mode(
                PlaybackMode::Advanced,
                None,
                Some(AudioBackend::Asio),
                Some(DsdOutputMode::NativeDsd),
                None,
                None,
            )
            .map(|_| ())
            .map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn set_dsd_output_mode(
    mode: DsdOutputMode,
    asio_driver_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .player
        .set_dsd_output_mode_with_driver(mode, asio_driver_id)
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
    let drivers = crate::audio::asio::drivers_snapshot();
    #[cfg(windows)]
    let (exclusive_mode_supported, dop_rates) = {
        use crate::audio::wasapi::{FormatNegotiator, WasapiDeviceManager};
        let mut manager = WasapiDeviceManager::new();
        if let Some(id) = state.player.current_output_device_id() {
            manager.select_device(Some(id));
        }
        match manager.get_active_device() {
            Ok(device) => (
                FormatNegotiator::exclusive_supported(&device),
                FormatNegotiator::probe_dop_rates(&device),
            ),
            Err(_) => (false, Vec::new()),
        }
    };
    #[cfg(not(windows))]
    let (exclusive_mode_supported, dop_rates) = {
        let _ = &state;
        (
            crate::sync_util::recover_mutex(&state.exclusive_adapter).is_supported(),
            Vec::new(),
        )
    };
    Ok(build_audio_capabilities(
        exclusive_mode_supported,
        &drivers,
        dop_rates,
    ))
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
pub async fn refresh_stream_url(
    track_id: String,
    url: String,
    expires_at: String,
    restart_current: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .player
        .refresh_stream_url(&track_id, url, expires_at, restart_current.unwrap_or(false))
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
pub async fn open_folder_dialog(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    if let Some(path) = folder.as_ref() {
        crate::fs_guard::remember_path(&state.allowed_fs_paths, path);
    }
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_files_dialog(state: State<'_, AppState>) -> Result<Option<Vec<String>>, String> {
    let files = rfd::FileDialog::new()
        .add_filter(
            "Audio Files",
            &[
                "mp3", "flac", "wav", "ogg", "m4a", "aac", "alac", "opus", "aiff", "dsf", "dff",
            ],
        )
        .pick_files();
    Ok(files.map(|list| {
        list.into_iter()
            .map(|path| {
                crate::fs_guard::remember_path(&state.allowed_fs_paths, &path);
                path.to_string_lossy().to_string()
            })
            .collect()
    }))
}

#[tauri::command]
pub async fn open_image_dialog(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Image Files", &["png", "jpg", "jpeg", "webp"])
        .pick_file();
    if let Some(path) = file.as_ref() {
        crate::fs_guard::remember_path(&state.allowed_fs_paths, path);
    }
    Ok(file.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn cache_playlist_cover(
    source_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    {
        let conn = state.db.lock();
        crate::fs_guard::assert_media_path(&conn, &state.allowed_fs_paths, &source_path).or_else(
            |_| crate::fs_guard::assert_scan_path(&conn, &state.allowed_fs_paths, &source_path),
        )?;
    }
    let source = std::path::Path::new(&source_path);
    if !source.is_file() {
        return Err("Selected cover image was not found".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg");
    let target_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("playlist-covers");
    std::fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let target = target_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    std::fs::copy(source, &target).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cache_image_data(
    cache_key: String,
    category: String,
    data_url: String,
    app: AppHandle,
) -> Result<String, String> {
    use base64::Engine;
    use sha2::{Digest, Sha256};

    if !matches!(category.as_str(), "remote-artwork" | "themes") {
        return Err("Unsupported image cache category".to_string());
    }
    let (header, encoded) = data_url.split_once(',').ok_or("Invalid image data")?;
    if !header.starts_with("data:image/") || !header.ends_with(";base64") {
        return Err("Only base64 image data is supported".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid base64 image data".to_string())?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("Image exceeds the 12 MB cache limit".to_string());
    }
    let format = image::guess_format(&bytes).map_err(|_| "Unsupported image format".to_string())?;
    if !matches!(
        format,
        image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP
    ) {
        return Err("Unsupported image format".to_string());
    }
    image::load_from_memory_with_format(&bytes, format)
        .map_err(|_| "Invalid image content".to_string())?;
    let extension = match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::WebP => "webp",
        _ => "jpg",
    };
    let digest = format!("{:x}", Sha256::digest(cache_key.as_bytes()));
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(category);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let target = directory.join(format!("{digest}.{extension}"));
    std::fs::write(&target, bytes).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn clear_image_cache(category: String, app: AppHandle) -> Result<(), String> {
    if !matches!(category.as_str(), "remote-artwork" | "themes") {
        return Err("Unsupported image cache category".to_string());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(category);
    if directory.exists() {
        std::fs::remove_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    Ok(())
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
    {
        let conn = state.db.lock();
        crate::fs_guard::assert_scan_path(&conn, &state.allowed_fs_paths, &path)?;
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_without_asio_drivers_disable_native_dsd() {
        let caps = build_audio_capabilities(true, &[], vec![DsdRate::Dsd64]);
        assert!(caps.exclusive_mode_supported);
        assert!(!caps.asio_supported);
        assert!(!caps.asio_drivers_present);
        assert!(!caps.native_dsd_supported);
        assert!(caps.dsd_rates.is_empty());
        assert!(caps.dop_supported);
        assert_eq!(caps.dop_rates, vec![DsdRate::Dsd64]);
    }

    #[test]
    fn capabilities_with_probed_asio_driver_expose_real_rates() {
        let drivers = vec![AsioDriverDTO {
            id: "driver-1".into(),
            name: "Test DAC".into(),
            native_dsd_supported: true,
            dsd_rates: vec![DsdRate::Dsd64, DsdRate::Dsd128],
        }];
        let caps = build_audio_capabilities(true, &drivers, Vec::new());
        assert!(caps.asio_supported);
        assert!(caps.asio_drivers_present);
        assert!(caps.native_dsd_supported);
        assert_eq!(caps.dsd_rates, vec![DsdRate::Dsd64, DsdRate::Dsd128]);
        assert!(!caps.dop_supported);
        assert!(caps.dop_rates.is_empty());
    }
}

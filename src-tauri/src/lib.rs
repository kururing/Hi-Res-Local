pub mod audio;
pub mod commands;
pub mod db;
pub mod error;
pub mod lyrics;
pub mod models;
pub mod scanner;
pub mod search;
pub mod state;
pub mod tags;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

use crate::audio::dto::AudioEvent;
use crate::commands::*;
use crate::db::queries_settings::get_app_settings;
use crate::db::Database;
use crate::scanner::watcher::LibraryWatcher;
use crate::state::AppState;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db = Arc::new(
                Database::open_default().map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?,
            );

            let app_state = AppState::new(Arc::clone(&db));

            // Setup audio event broadcaster to Tauri Web frontend
            let player = Arc::clone(&app_state.player);
            let app_handle = app.handle().clone();
            let mut rx = player.subscribe();

            tauri::async_runtime::spawn(async move {
                while let Ok(event) = rx.recv().await {
                    match event {
                        AudioEvent::StateChanged(state) => {
                            let state_str = match state {
                                crate::audio::dto::PlaybackState::Playing => "playing",
                                crate::audio::dto::PlaybackState::Paused => "paused",
                                crate::audio::dto::PlaybackState::Stopped => "stopped",
                                crate::audio::dto::PlaybackState::Buffering => "loading",
                                crate::audio::dto::PlaybackState::Ended => "stopped",
                            };
                            let _ = app_handle.emit(
                                "audio://state_changed",
                                serde_json::json!({ "state": state_str }),
                            );
                            let _ = app_handle.emit("audio://state", &state);
                            if state == crate::audio::dto::PlaybackState::Ended {
                                let _ = app_handle
                                    .emit("audio://track_ended", serde_json::json!({}));
                            }
                        }
                        AudioEvent::TrackChanged(track) => {
                            let _ = app_handle.emit("audio://track_changed", &track);
                        }
                        AudioEvent::ProgressUpdated(progress) => {
                            let _ = app_handle.emit(
                                "audio://position",
                                serde_json::json!({
                                    "position_secs": (progress.position_ms as f64) / 1000.0
                                }),
                            );
                            let _ = app_handle.emit("audio://progress", &progress);
                        }
                        AudioEvent::VolumeChanged { volume, is_muted } => {
                            let _ = app_handle.emit(
                                "audio://volume_changed",
                                serde_json::json!({ "volume": volume, "is_muted": is_muted }),
                            );
                        }
                        AudioEvent::QueueUpdated {
                            queue,
                            current_index,
                        } => {
                            let _ = app_handle.emit(
                                "audio://queue_updated",
                                serde_json::json!({ "queue": queue, "current_index": current_index }),
                            );
                        }
                        AudioEvent::RepeatModeChanged(mode) => {
                            let _ = app_handle.emit("audio://repeat_mode_changed", &mode);
                        }
                        AudioEvent::ShuffleChanged(shuffle) => {
                            let _ = app_handle.emit(
                                "audio://shuffle_changed",
                                serde_json::json!({ "shuffle": shuffle }),
                            );
                        }
                        AudioEvent::QualityUpdated(badge) => {
                            let _ = app_handle.emit("audio://quality_updated", &badge);
                        }
                        AudioEvent::DeviceLost(msg) => {
                            let _ = app_handle
                                .emit("audio://device_lost", serde_json::json!({ "error": msg }));
                        }
                        AudioEvent::ErrorOccurred(msg) => {
                            let _ = app_handle
                                .emit("audio://error", serde_json::json!({ "message": msg }));
                        }
                    }
                }
            });

            // Periodic smooth position progress ticker when playing
            let player_ticker = Arc::clone(&app_state.player);
            let app_handle_ticker = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
                loop {
                    interval.tick().await;
                    let snap = player_ticker.get_snapshot();
                    if snap.state == crate::audio::dto::PlaybackState::Playing {
                        let _ = app_handle_ticker.emit(
                            "audio://position",
                            serde_json::json!({
                                "position_secs": (snap.progress.position_ms as f64) / 1000.0
                            }),
                        );
                    }
                }
            });

            // Initialize watcher for active roots if enabled in settings
            if let Ok(settings) = {
                let conn = db.lock();
                get_app_settings(&conn)
            } {
                if settings.watch_directories {
                    if let Ok(mut watcher) =
                        LibraryWatcher::new(Arc::clone(&db), Some(app.handle().clone()))
                    {
                        for root in &settings.library_roots {
                            if root.is_active {
                                let path = PathBuf::from(&root.path);
                                let _ = watcher.watch_path(&path);
                            }
                        }
                        if let Ok(mut guard) = app_state.watcher.lock() {
                            *guard = Some(watcher);
                        }
                    }
                }
            }

            app.manage(app_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Audio Playback & Transport
            play_track,
            play_current,
            pause_playback,
            resume_playback,
            stop_playback,
            toggle_play_pause,
            seek_playback,
            next_track,
            previous_track,
            // Volume & Loop & Shuffle
            set_volume,
            set_muted,
            toggle_mute,
            set_loop_mode,
            set_repeat_mode,
            set_shuffle,
            // Snapshot & Status
            get_playback_status,
            get_player_snapshot,
            // Hardware & Device
            get_audio_output_devices,
            set_audio_output_device,
            set_bit_perfect,
            get_audio_capabilities,
            // DSP (EQ, Crossfade, ReplayGain)
            set_equalizer,
            set_crossfade,
            set_replay_gain,
            // Queue Management
            queue_add,
            queue_play_next,
            queue_remove,
            queue_reorder,
            queue_clear,
            queue_set_index,
            get_queue,
            // Dialogs
            open_folder_dialog,
            open_files_dialog,
            // Library & Scanning
            get_all_tracks,
            get_library_stats,
            scan_directory,
            add_library_root,
            get_library_roots,
            remove_library_root,
            set_library_root_active,
            scan_library,
            get_duplicate_groups,
            // Tracks
            get_tracks,
            get_track_by_id,
            delete_track,
            set_track_favorite,
            set_track_rating,
            // Playlists & Smart Playlists
            create_playlist,
            get_playlists,
            get_playlist,
            update_playlist,
            delete_playlist,
            add_tracks_to_playlist,
            remove_tracks_from_playlist,
            reorder_playlist_tracks,
            export_playlist_m3u,
            import_playlist_m3u,
            evaluate_smart_playlist_rules,
            // Tags
            update_track_tags,
            // Lyrics
            get_track_lyrics,
            parse_lrc_content,
            // Browse
            get_home_feed,
            get_artists,
            get_artist_detail,
            get_albums,
            get_album_detail,
            get_genres,
            // Search
            search_library,
            // History
            record_play,
            get_play_history,
            clear_play_history,
            // Favorites
            set_artist_favorite,
            set_album_favorite,
            // Settings
            get_settings,
            update_settings,
            // Backup & Restore
            backup_database,
            restore_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub mod audio;
pub mod commands;
pub mod db;
pub mod discord;
pub mod error;
pub mod lyrics;
pub mod models;
pub mod panic_hook;
pub mod scanner;
pub mod search;
pub mod state;
pub mod sync_util;
pub mod tags;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

use crate::audio::dto::AudioEvent;
use crate::commands::*;
use crate::db::queries_settings::get_app_settings;
use crate::db::Database;
use crate::scanner::watcher::LibraryWatcher;
use crate::state::AppState;

pub fn run() {
    panic_hook::install();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Open Nghe Nhac Pro Max", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("Nghe Nhac Pro Max");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // A previous close-to-tray session can leave the main webview hidden.
            // Always restore the window when the application is launched explicitly.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

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
                                crate::audio::dto::PlaybackState::Ended => "ended",
                            };
                            let _ = app_handle.emit(
                                "audio://state_changed",
                                serde_json::json!({ "state": state_str }),
                            );
                            let _ = app_handle.emit("audio://state", &state);
                            if state == crate::audio::dto::PlaybackState::Ended {
                                let _ = app_handle
                                    .emit("audio://track_ended", serde_json::json!({}));
                                // Auto-advance is owned by the backend queue. Ended
                                // fires only when no preloaded next track existed
                                // (end of queue, or a preload failure); next() plays
                                // the following track or stops cleanly.
                                if let Err(err) = player.next() {
                                    tracing::warn!("Auto-advance after track end failed: {err}");
                                }
                            }
                        }
                        AudioEvent::TrackChanged(track) => {
                            let _ = app_handle.emit("audio://track_changed", &track);
                        }
                        AudioEvent::TrackTransitioned(track) => {
                            // Gapless/crossfade moved to the preloaded track: sync
                            // the queue index and schedule the next preload.
                            player.handle_track_transitioned(&track);
                            let _ = app_handle.emit("audio://track_changed", &Some(track));
                        }
                        AudioEvent::ProgressUpdated(progress) => {
                            let _ = app_handle.emit(
                                "audio://position",
                                serde_json::json!({
                                    "position_secs": (progress.position_ms as f64) / 1000.0,
                                    "duration_secs": (progress.duration_ms as f64) / 1000.0
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

            // ~10 Hz progress ticks from atomics only (no queue clone, no audio-thread emit).
            let player_ticker = Arc::clone(&app_state.player);
            let app_handle_ticker = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));
                let mut tick_count = 0u32;
                let mut last_underrun_count = 0u64;
                loop {
                    interval.tick().await;
                    if let Some(transition) = player_ticker.take_audible_transition() {
                        player_ticker.handle_track_transitioned(&transition.track);
                        let _ = app_handle_ticker
                            .emit("audio://track_changed", &Some(&transition.track));
                        let _ = app_handle_ticker
                            .emit("audio://quality_updated", &transition.quality_badge);
                    }
                    if let Some((position_ms, duration_ms)) = player_ticker.get_progress_tick() {
                        let _ = app_handle_ticker.emit(
                            "audio://position",
                            serde_json::json!({
                                "position_secs": (position_ms as f64) / 1000.0,
                                "duration_secs": (duration_ms as f64) / 1000.0
                            }),
                        );
                    }
                    tick_count += 1;
                    if tick_count >= 10 {
                        tick_count = 0;
                        let (count, missing_samples) = player_ticker.underrun_stats();
                        if count != last_underrun_count {
                            let _ = app_handle_ticker.emit(
                                "audio://underrun",
                                serde_json::json!({
                                    "count": count,
                                    "missing_samples": missing_samples
                                }),
                            );
                            last_underrun_count = count;
                        }
                    }
                }
            });

            // Initialize watcher for active roots if enabled in settings
            match {
                let conn = db.lock();
                get_app_settings(&conn)
            } {
                Ok(settings) if settings.watch_directories => {
                    match LibraryWatcher::new(Arc::clone(&db), Some(app.handle().clone())) {
                        Ok(mut watcher) => {
                            for root in &settings.library_roots {
                                if root.is_active {
                                    let path = PathBuf::from(&root.path);
                                    if let Err(err) = watcher.watch_path(&path) {
                                        tracing::warn!(
                                            "Failed to watch library root {}: {err}",
                                            root.path
                                        );
                                    }
                                }
                            }
                            *crate::sync_util::recover_mutex(&app_state.watcher) = Some(watcher);
                        }
                        Err(err) => {
                            tracing::warn!("Failed to initialize library watcher: {err}");
                        }
                    }
                }
                Ok(_) => {}
                Err(err) => tracing::warn!("Failed to load settings for watcher init: {err}"),
            }

            app.manage(app_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Audio Playback & Transport
            play_track,
            play_queue,
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
            queue_clear_upcoming,
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
            save_romanized_lyrics,
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
            get_favorite_artists,
            get_favorite_albums,
            // Settings
            get_settings,
            update_settings,
            quit_app,
            set_discord_presence,
            // Backup & Restore
            backup_database,
            restore_database
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!("error while running tauri application: {err}");
            eprintln!("error while running tauri application: {err}");
            std::process::exit(1);
        });
}

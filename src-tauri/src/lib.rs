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
use tauri::Manager;

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
            // Library & Scanning
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

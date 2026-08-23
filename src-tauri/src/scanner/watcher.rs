use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::db::queries_tracks::{delete_track, get_track_by_path, upsert_track};
use crate::db::Database;
use crate::scanner::metadata::extract_metadata;
use crate::scanner::walker::is_audio_file;

pub struct LibraryWatcher {
    watcher: RecommendedWatcher,
    watch_tx: Sender<PathBuf>,
}

impl LibraryWatcher {
    pub fn new(db: Arc<Database>, app_handle: Option<AppHandle>) -> Result<Self, notify::Error> {
        let (tx, rx) = channel::<notify::Result<Event>>();
        let (path_tx, path_rx) = channel::<PathBuf>();

        let watcher = RecommendedWatcher::new(tx, Config::default())?;

        // Background worker to debounce and process filesystem changes
        let db_clone = Arc::clone(&db);
        let app_handle_clone = app_handle.clone();
        thread::spawn(move || {
            process_events(rx, path_rx, db_clone, app_handle_clone);
        });

        Ok(Self {
            watcher,
            watch_tx: path_tx,
        })
    }

    pub fn watch_path(&mut self, path: &Path) -> Result<(), notify::Error> {
        if path.exists() {
            self.watcher.watch(path, RecursiveMode::Recursive)?;
            let _ = self.watch_tx.send(path.to_path_buf());
        }
        Ok(())
    }

    pub fn unwatch_path(&mut self, path: &Path) -> Result<(), notify::Error> {
        self.watcher.unwatch(path)
    }
}

fn process_events(
    rx: Receiver<notify::Result<Event>>,
    _path_rx: Receiver<PathBuf>,
    db: Arc<Database>,
    app_handle: Option<AppHandle>,
) {
    while let Ok(event_res) = rx.recv() {
        if let Ok(event) = event_res {
            let paths = event.paths;
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for p in paths {
                        if is_audio_file(&p) && p.is_file() {
                            // Give brief moment for write completion
                            thread::sleep(Duration::from_millis(100));
                            let track = extract_metadata(&p);
                            {
                                let conn = db.lock();
                                let _ = upsert_track(&conn, &track);
                            }
                            if let Some(ref handle) = app_handle {
                                let _ = handle.emit("library:track_updated", &track);
                            }
                        }
                    }
                }
                EventKind::Remove(_) => {
                    for p in paths {
                        if is_audio_file(&p) {
                            let path_str = p.to_string_lossy().to_string();
                            let conn = db.lock();
                            if let Ok(Some(track)) = get_track_by_path(&conn, &path_str) {
                                let _ = delete_track(&conn, &track.id);
                                if let Some(ref handle) = app_handle {
                                    let _ = handle.emit("library:track_deleted", &track.id);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

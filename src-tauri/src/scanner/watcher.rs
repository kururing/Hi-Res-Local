use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::db::queries_tracks::{delete_track, get_track_by_path, upsert_track};
use crate::db::Database;
use crate::scanner::metadata::extract_metadata_safe;
use crate::scanner::walker::is_audio_file;

/// Quiet period before a burst of filesystem events is processed. Coalesces
/// rapid consecutive writes (file copies, tag editors) into a single pass.
const DEBOUNCE: Duration = Duration::from_millis(500);
/// Idle receive timeout when nothing is pending.
const IDLE_WAIT: Duration = Duration::from_secs(3600);

pub struct LibraryWatcher {
    watcher: RecommendedWatcher,
    watch_tx: Sender<PathBuf>,
}

impl LibraryWatcher {
    pub fn new(db: Arc<Database>, app_handle: Option<AppHandle>) -> Result<Self, notify::Error> {
        let (tx, rx) = channel::<notify::Result<Event>>();
        let (path_tx, _path_rx) = channel::<PathBuf>();

        let watcher = RecommendedWatcher::new(tx, Config::default())?;

        // Background worker to debounce and process filesystem changes
        let db_clone = Arc::clone(&db);
        let app_handle_clone = app_handle.clone();
        let spawn_result = thread::Builder::new()
            .name("library-watcher".into())
            .spawn(move || {
                process_events(rx, db_clone, app_handle_clone);
            });
        if let Err(err) = spawn_result {
            tracing::error!("Failed to spawn library watcher thread: {err}");
        }

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
    db: Arc<Database>,
    app_handle: Option<AppHandle>,
) {
    let mut pending: HashSet<PathBuf> = HashSet::new();
    let mut flush_deadline: Option<Instant> = None;

    loop {
        let timeout = flush_deadline
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(IDLE_WAIT);

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                if matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    for path in event.paths {
                        if is_audio_file(&path) {
                            pending.insert(path);
                        }
                    }
                    if !pending.is_empty() && flush_deadline.is_none() {
                        flush_deadline = Some(Instant::now() + DEBOUNCE);
                    }
                }
            }
            Ok(Err(err)) => {
                tracing::warn!("Library watcher event error: {err}");
            }
            Err(RecvTimeoutError::Timeout) => {
                flush_pending(&mut pending, &db, app_handle.as_ref());
                flush_deadline = None;
            }
            Err(RecvTimeoutError::Disconnected) => {
                flush_pending(&mut pending, &db, app_handle.as_ref());
                tracing::info!("Library watcher channel closed; watcher thread exiting");
                return;
            }
        }
    }
}

fn flush_pending(pending: &mut HashSet<PathBuf>, db: &Database, app_handle: Option<&AppHandle>) {
    for path in pending.drain() {
        if path.is_file() {
            // extract_metadata_safe: a corrupt or panicking tag parser must never
            // kill the watcher thread.
            let track = extract_metadata_safe(&path);
            let upsert_result = {
                let conn = db.lock();
                upsert_track(&conn, &track)
            };
            match upsert_result {
                Ok(()) => {
                    if let Some(handle) = app_handle {
                        let _ = handle.emit("library:track_updated", &track);
                    }
                }
                Err(err) => {
                    tracing::warn!("Watcher failed to upsert {}: {err}", path.display());
                }
            }
        } else {
            // File no longer exists: treat as removal (delete or rename-away).
            let path_str = path.to_string_lossy().to_string();
            let deleted_id = {
                let conn = db.lock();
                match get_track_by_path(&conn, &path_str) {
                    Ok(Some(track)) => match delete_track(&conn, &track.id) {
                        Ok(_) => Some(track.id),
                        Err(err) => {
                            tracing::warn!("Watcher failed to delete {}: {err}", path.display());
                            None
                        }
                    },
                    Ok(None) => None,
                    Err(err) => {
                        tracing::warn!("Watcher lookup failed for {}: {err}", path.display());
                        None
                    }
                }
            };
            if let (Some(id), Some(handle)) = (deleted_id, app_handle) {
                let _ = handle.emit("library:track_deleted", &id);
            }
        }
    }
}

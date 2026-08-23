pub mod cover_cache;
pub mod duplicate_detector;
pub mod metadata;
pub mod walker;
pub mod watcher;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::db::queries_library::update_root_scanned_at;
use crate::db::queries_tracks::{
    delete_tracks_by_paths, get_tracks, update_duplicate_status, upsert_tracks_batch,
};
use crate::db::Database;
use crate::error::AppResult;
use crate::models::track::Track;
use crate::scanner::duplicate_detector::detect_and_assign_duplicates;
use crate::scanner::metadata::extract_metadata;
use crate::scanner::walker::scan_directory_for_audio_files;

pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(serde::Serialize, Clone)]
pub struct ScanProgressPayload {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

pub fn scan_library_roots(
    db: Arc<Database>,
    roots: &[PathBuf],
    app_handle: Option<&AppHandle>,
) -> AppResult<usize> {
    let mut all_audio_files = Vec::new();
    for root in roots {
        if root.exists() {
            let files = scan_directory_for_audio_files(root);
            all_audio_files.extend(files);
        }
    }

    let total = all_audio_files.len();
    let mut tracks: Vec<Track> = Vec::with_capacity(total);

    for (idx, file_path) in all_audio_files.iter().enumerate() {
        let track = extract_metadata(file_path);
        tracks.push(track);

        if let Some(handle) = app_handle {
            if idx % 10 == 0 || idx + 1 == total {
                let _ = handle.emit(
                    "library:scan_progress",
                    ScanProgressPayload {
                        current: idx + 1,
                        total,
                        current_file: file_path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                    },
                );
            }
        }
    }

    // Run duplicate detection across all tracks
    detect_and_assign_duplicates(&mut tracks);

    // Batch upsert into database
    {
        let mut conn = db.lock();
        upsert_tracks_batch(&mut conn, &tracks)?;

        // Update duplicate status in DB
        for track in &tracks {
            let _ = update_duplicate_status(
                &conn,
                &track.id,
                track.duplicate_group_id.as_deref(),
                track.is_primary,
            );
        }

        // Clean up deleted files belonging to these roots
        let existing_tracks = get_tracks(&conn, None)?;
        let discovered_paths: HashSet<String> = all_audio_files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();

        let mut paths_to_delete = Vec::new();
        for t in existing_tracks {
            let t_path = Path::new(&t.path);
            let belongs_to_scanned_root = roots.iter().any(|r| t_path.starts_with(r));
            if belongs_to_scanned_root && !discovered_paths.contains(&t.path) && !t_path.exists() {
                paths_to_delete.push(t.path);
            }
        }

        if !paths_to_delete.is_empty() {
            let _ = delete_tracks_by_paths(&mut conn, &paths_to_delete);
        }

        // Update last scanned timestamp for roots
        for root in roots {
            let _ = update_root_scanned_at(&conn, &root.to_string_lossy());
        }
    }

    if let Some(handle) = app_handle {
        let _ = handle.emit("library:scan_complete", total);
    }

    Ok(total)
}

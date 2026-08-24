pub mod cover_cache;
pub mod duplicate_detector;
pub mod metadata;
pub mod walker;
pub mod watcher;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use rayon::prelude::*;
use tauri::{AppHandle, Emitter};

use crate::db::queries_library::update_root_scanned_at;
use crate::db::queries_tracks::{
    delete_tracks_by_paths, get_tracks_summary, update_duplicate_status, upsert_tracks_batch,
};
use crate::db::Database;
use crate::error::AppResult;
use crate::models::track::Track;
use crate::scanner::duplicate_detector::detect_and_assign_duplicates;
use crate::scanner::metadata::{extract_metadata_safe, file_identity};
use crate::scanner::walker::scan_directory_for_audio_files;
use crate::sync_util::set_current_thread_priority_low;

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

/// True when the file on disk still matches the identity recorded in the DB,
/// so its previously extracted metadata can be reused without re-parsing.
fn is_file_unchanged(path: &Path, db_track: &Track) -> bool {
    if db_track.is_corrupt {
        return false;
    }
    let (size, modified) = file_identity(path);
    size == db_track.file_size && modified == db_track.file_modified_at
}

fn emit_progress(app_handle: Option<&AppHandle>, current: usize, total: usize, file: &Path) {
    if let Some(handle) = app_handle {
        let _ = handle.emit(
            "library://scan_progress",
            ScanProgressPayload {
                current,
                total,
                current_file: file
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            },
        );
    }
}

pub fn scan_library_roots(
    db: Arc<Database>,
    roots: &[PathBuf],
    app_handle: Option<&AppHandle>,
) -> AppResult<usize> {
    set_current_thread_priority_low();

    let mut all_audio_files = Vec::new();
    for root in roots {
        if root.exists() {
            let files = scan_directory_for_audio_files(root);
            all_audio_files.extend(files);
        }
    }

    let total = all_audio_files.len();

    // Incremental rescan: reuse DB rows for files whose size+mtime are unchanged
    // so only new/modified files pay the metadata extraction cost.
    let mut existing_by_path: HashMap<String, Track> = {
        let conn = db.lock();
        get_tracks_summary(&conn, None)?
            .into_iter()
            .map(|t| (t.path.clone(), t))
            .collect()
    };

    let mut tracks: Vec<Track> = Vec::with_capacity(total);
    let mut to_extract: Vec<PathBuf> = Vec::new();
    for file_path in &all_audio_files {
        let path_str = file_path.to_string_lossy().to_string();
        match existing_by_path.remove(&path_str) {
            Some(db_track) if is_file_unchanged(file_path, &db_track) => tracks.push(db_track),
            _ => to_extract.push(file_path.clone()),
        }
    }

    let skipped = tracks.len();
    if skipped > 0 {
        if let Some(first) = all_audio_files.first() {
            emit_progress(app_handle, skipped, total, first);
        }
    }

    // Extract metadata for changed/new files in parallel.
    let progress_counter = AtomicUsize::new(0);
    let extracted: Vec<Track> = to_extract
        .par_iter()
        .map(|file_path| {
            let track = extract_metadata_safe(file_path);
            let done = progress_counter.fetch_add(1, Ordering::Relaxed) + 1;
            if done % 10 == 0 || skipped + done == total {
                emit_progress(app_handle, skipped + done, total, file_path);
            }
            track
        })
        .collect();

    let extracted_paths: HashSet<String> = extracted.iter().map(|t| t.path.clone()).collect();
    tracks.extend(extracted);

    // Run duplicate detection across all tracks (reused + freshly extracted)
    detect_and_assign_duplicates(&mut tracks);

    // Batch upsert into database
    {
        let mut conn = db.lock();

        let changed_tracks: Vec<Track> = tracks
            .iter()
            .filter(|t| extracted_paths.contains(&t.path))
            .cloned()
            .collect();
        upsert_tracks_batch(&mut conn, &changed_tracks)?;

        // Update duplicate status for every track in one transaction.
        {
            let tx = conn.transaction()?;
            for track in &tracks {
                if let Err(err) = update_duplicate_status(
                    &tx,
                    &track.id,
                    track.duplicate_group_id.as_deref(),
                    track.is_primary,
                ) {
                    tracing::warn!("Failed to update duplicate status for {}: {err}", track.id);
                }
            }
            tx.commit()?;
        }

        // Clean up deleted files belonging to these roots. Entries left in
        // existing_by_path were not discovered by this scan.
        let mut paths_to_delete = Vec::new();
        for path in existing_by_path.keys() {
            let t_path = Path::new(path);
            let belongs_to_scanned_root = roots.iter().any(|r| t_path.starts_with(r));
            if belongs_to_scanned_root && !t_path.exists() {
                paths_to_delete.push(path.clone());
            }
        }

        if !paths_to_delete.is_empty() {
            if let Err(err) = delete_tracks_by_paths(&mut conn, &paths_to_delete) {
                tracing::warn!("Failed to remove deleted tracks from library: {err}");
            }
        }

        // Update last scanned timestamp for roots
        for root in roots {
            if let Err(err) = update_root_scanned_at(&conn, &root.to_string_lossy()) {
                tracing::warn!("Failed to update scanned-at for {}: {err}", root.display());
            }
        }
    }

    if let Some(handle) = app_handle {
        let _ = handle.emit(
            "library://scan_finished",
            serde_json::json!({ "total": total, "success": true }),
        );
    }

    Ok(total)
}

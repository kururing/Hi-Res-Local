//! Local music library scanning, metadata indexing, and SQLite persistence.

pub mod db;
pub mod error;
pub mod metadata;
pub mod scanner;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::app::{LibraryBackend, LibraryStats, Playlist, PlaylistId, Track, TrackId};
pub use error::LibraryError;
pub use metadata::{
    extract_metadata, filename_fallback_title, generate_deterministic_track_id,
    is_supported_audio_file, SUPPORTED_EXTENSIONS,
};
pub use scanner::{discover_audio_files, scan_directory_tracks};

/// Thread-safe local music library manager and persistence engine.
#[derive(Debug, Clone)]
pub struct LibraryManager {
    db: Arc<Mutex<Option<db::LibraryDatabase>>>,
    db_path: Option<PathBuf>,
    is_in_memory: bool,
}

impl Default for LibraryManager {
    fn default() -> Self {
        Self::new()
    }
}

impl LibraryManager {
    /// Creates a new `LibraryManager` using the default platform data directory.
    pub fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(None)),
            db_path: None,
            is_in_memory: false,
        }
    }

    /// Creates a `LibraryManager` backed by a SQLite database at a specific path.
    pub fn with_path<P: AsRef<Path>>(path: P) -> Self {
        Self {
            db: Arc::new(Mutex::new(None)),
            db_path: Some(path.as_ref().to_path_buf()),
            is_in_memory: false,
        }
    }

    /// Creates an in-memory `LibraryManager` (ideal for testing and isolated sessions).
    pub fn in_memory() -> Result<Self, LibraryError> {
        let db = db::LibraryDatabase::open_in_memory()?;
        Ok(Self {
            db: Arc::new(Mutex::new(Some(db))),
            db_path: None,
            is_in_memory: true,
        })
    }

    /// Helper to get or lazily initialize the database connection.
    fn with_db<F, R>(&self, f: F) -> Result<R, LibraryError>
    where
        F: FnOnce(&mut db::LibraryDatabase) -> Result<R, LibraryError>,
    {
        let mut guard = self
            .db
            .lock()
            .map_err(|e| LibraryError::Lock(format!("Mutex poisoned: {e}")))?;

        if guard.is_none() {
            let db = if self.is_in_memory {
                db::LibraryDatabase::open_in_memory()?
            } else if let Some(ref path) = self.db_path {
                db::LibraryDatabase::open(path)?
            } else {
                db::LibraryDatabase::open_default()?
            };
            *guard = Some(db);
        }

        let db_ref = guard.as_mut().expect("Database initialized above");
        f(db_ref)
    }

    /// Creates a new user playlist and persists it to SQLite.
    pub fn create_playlist(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> Result<Playlist, LibraryError> {
        self.with_db(|db| db.create_playlist(name, description))
    }

    /// Deletes a playlist by ID from SQLite.
    pub fn delete_playlist(&self, id: &PlaylistId) -> Result<(), LibraryError> {
        self.with_db(|db| db.delete_playlist(id))
    }

    /// Adds a track to a playlist and updates SQLite.
    pub fn add_track_to_playlist(
        &self,
        playlist_id: &PlaylistId,
        track_id: &TrackId,
    ) -> Result<(), LibraryError> {
        self.with_db(|db| db.add_track_to_playlist(playlist_id, track_id))
    }

    /// Removes a track from a playlist in SQLite.
    pub fn remove_track_from_playlist(
        &self,
        playlist_id: &PlaylistId,
        track_id: &TrackId,
    ) -> Result<(), LibraryError> {
        self.with_db(|db| db.remove_track_from_playlist(playlist_id, track_id))
    }

    /// Synchronizes a full playlist struct and its track sequence in SQLite.
    pub fn save_playlist(&self, playlist: &Playlist) -> Result<(), LibraryError> {
        self.with_db(|db| db.save_playlist(playlist))
    }

    /// Upserts a single track into the database.
    pub fn upsert_track(&self, track: &Track) -> Result<(), LibraryError> {
        self.with_db(|db| db.upsert_track(track))
    }

    /// Upserts a batch of tracks into the database.
    pub fn upsert_tracks(&self, tracks: &[Track]) -> Result<(), LibraryError> {
        self.with_db(|db| db.upsert_tracks_batch(tracks))
    }
}

impl LibraryBackend for LibraryManager {
    fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.with_db(|db| {
            db.init_schema()?;
            Ok(())
        })
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
    }

    fn scan_directory(
        &self,
        path: &Path,
    ) -> Result<Vec<Track>, Box<dyn std::error::Error + Send + Sync>> {
        let discovered_files = discover_audio_files(path);
        let mut active_paths = HashSet::with_capacity(discovered_files.len());
        for p in &discovered_files {
            active_paths.insert(p.clone());
            if let Ok(canon) = p.canonicalize() {
                active_paths.insert(canon);
            }
        }

        let scanned_tracks = scan_directory_tracks(path);

        self.with_db(|db| {
            // Batch upsert all scanned tracks
            if !scanned_tracks.is_empty() {
                db.upsert_tracks_batch(&scanned_tracks)?;
            }

            // Stale-file cleanup: remove tracks under scanned directory that no longer exist
            let cleaned = db.cleanup_stale_tracks_in_dir(path, &active_paths)?;
            if cleaned > 0 {
                tracing::info!(
                    "Cleaned up {} stale tracks from directory {:?}",
                    cleaned,
                    path
                );
            }

            Ok(())
        })
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

        Ok(scanned_tracks)
    }

    fn get_all_tracks(&self) -> Result<Vec<Track>, Box<dyn std::error::Error + Send + Sync>> {
        self.with_db(|db| db.get_all_tracks())
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
    }

    fn get_track_by_id(
        &self,
        id: &TrackId,
    ) -> Result<Option<Track>, Box<dyn std::error::Error + Send + Sync>> {
        self.with_db(|db| db.get_track_by_id(id))
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
    }

    fn get_playlists(&self) -> Result<Vec<Playlist>, Box<dyn std::error::Error + Send + Sync>> {
        self.with_db(|db| db.get_playlists())
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)
    }

    fn get_stats(&self) -> LibraryStats {
        self.with_db(|db| db.get_stats()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::time::Duration;

    #[test]
    fn test_in_memory_initialization_and_stats() {
        let mut manager = LibraryManager::in_memory().expect("in_memory DB should initialize");
        manager.initialize().expect("initialize should succeed");

        let stats = manager.get_stats();
        assert_eq!(stats.total_tracks, 0);
        assert_eq!(stats.total_artists, 0);
        assert_eq!(stats.total_albums, 0);
        assert_eq!(stats.total_duration_secs, 0);
    }

    #[test]
    fn test_track_upsert_and_queries() {
        let manager = LibraryManager::in_memory().expect("in_memory DB should initialize");
        let track_id = TrackId::new();
        let track = Track {
            id: track_id,
            title: "Test Song".to_string(),
            artist: "Test Artist".to_string(),
            album: "Test Album".to_string(),
            duration: Duration::from_secs(180),
            path: PathBuf::from("/music/test_song.mp3"),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
            genre: Some("Pop".to_string()),
            sample_rate: Some(44100),
            bitrate: Some(320),
            channels: Some(2),
            bit_depth: Some(16),
            date_added: chrono::Utc::now(),
        };

        manager.upsert_track(&track).expect("upsert should succeed");

        let fetched = manager
            .get_track_by_id(&track_id)
            .expect("query should succeed")
            .expect("track should exist");

        assert_eq!(fetched.id, track_id);
        assert_eq!(fetched.title, "Test Song");
        assert_eq!(fetched.artist, "Test Artist");
        assert_eq!(fetched.album, "Test Album");
        assert_eq!(fetched.duration, Duration::from_secs(180));
        assert_eq!(fetched.year, Some(2026));

        let all = manager
            .get_all_tracks()
            .expect("get_all_tracks should succeed");
        assert_eq!(all.len(), 1);

        let stats = manager.get_stats();
        assert_eq!(stats.total_tracks, 1);
        assert_eq!(stats.total_artists, 1);
        assert_eq!(stats.total_albums, 1);
        assert_eq!(stats.total_duration_secs, 180);
    }

    #[test]
    fn test_deterministic_track_id() {
        let path1 = Path::new("music/pop/song1.mp3");
        let path2 = Path::new("music/pop/song1.mp3");
        let path3 = Path::new("music/rock/song2.mp3");

        let id1 = generate_deterministic_track_id(path1);
        let id2 = generate_deterministic_track_id(path2);
        let id3 = generate_deterministic_track_id(path3);

        assert_eq!(id1, id2, "Same path must generate identical track ID");
        assert_ne!(
            id1, id3,
            "Different paths must generate different track IDs"
        );
    }

    #[test]
    fn test_filename_fallback_title() {
        assert_eq!(
            filename_fallback_title(Path::new("01 - Bohemian Rhapsody.mp3")),
            "Bohemian Rhapsody"
        );
        assert_eq!(
            filename_fallback_title(Path::new("02. Hotel California.flac")),
            "Hotel California"
        );
        assert_eq!(
            filename_fallback_title(Path::new("sweet_child_o_mine.wav")),
            "sweet child o mine"
        );
        assert_eq!(
            filename_fallback_title(Path::new("03_Song_Name.ogg")),
            "Song Name"
        );
    }

    #[test]
    fn test_playlist_crud_and_tracks() {
        let manager = LibraryManager::in_memory().expect("in_memory DB should initialize");

        let pl = manager
            .create_playlist("Chill Vibes", Some("Relaxing tunes"))
            .expect("create playlist");
        assert_eq!(pl.name, "Chill Vibes");
        assert_eq!(pl.description.as_deref(), Some("Relaxing tunes"));
        assert!(pl.track_ids.is_empty());

        let t1 = TrackId::new();
        let t2 = TrackId::new();

        // Must insert tracks first to satisfy foreign key constraint
        manager
            .upsert_track(&Track {
                id: t1,
                title: "Track 1".to_string(),
                path: PathBuf::from("/music/track1.mp3"),
                ..Default::default()
            })
            .unwrap();

        manager
            .upsert_track(&Track {
                id: t2,
                title: "Track 2".to_string(),
                path: PathBuf::from("/music/track2.mp3"),
                ..Default::default()
            })
            .unwrap();

        manager.add_track_to_playlist(&pl.id, &t1).expect("add t1");
        manager.add_track_to_playlist(&pl.id, &t2).expect("add t2");

        let playlists = manager.get_playlists().expect("get playlists");
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].track_ids, vec![t1, t2]);

        manager
            .remove_track_from_playlist(&pl.id, &t1)
            .expect("remove t1");
        let playlists_after_remove = manager.get_playlists().expect("get playlists");
        assert_eq!(playlists_after_remove[0].track_ids, vec![t2]);

        manager.delete_playlist(&pl.id).expect("delete playlist");
        let empty_playlists = manager.get_playlists().expect("get playlists");
        assert!(empty_playlists.is_empty());
    }

    #[test]
    fn test_scan_directory_and_stale_cleanup() {
        let temp_dir = std::env::temp_dir().join(format!("nghenhac_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let song1 = temp_dir.join("01 - Test Song.mp3");
        let song2 = temp_dir.join("02 - Another Song.flac");
        let non_audio = temp_dir.join("notes.txt");

        {
            let mut f1 = File::create(&song1).unwrap();
            f1.write_all(b"fake audio data 1").unwrap();

            let mut f2 = File::create(&song2).unwrap();
            f2.write_all(b"fake audio data 2").unwrap();

            let mut f3 = File::create(&non_audio).unwrap();
            f3.write_all(b"some notes").unwrap();
        }

        let manager = LibraryManager::in_memory().expect("in memory manager");
        let scanned = manager.scan_directory(&temp_dir).expect("scan directory");
        assert_eq!(scanned.len(), 2);

        let all = manager.get_all_tracks().expect("get all tracks");
        assert_eq!(all.len(), 2);

        // Delete one audio file and rescan -> stale file cleanup
        std::fs::remove_file(&song1).unwrap();
        let scanned_again = manager.scan_directory(&temp_dir).expect("rescan");
        assert_eq!(scanned_again.len(), 1);

        let all_after = manager
            .get_all_tracks()
            .expect("get all tracks after rescan");
        assert_eq!(all_after.len(), 1);
        assert_eq!(all_after[0].title, "Another Song");

        // Clean up temp dir
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_corrupt_unreadable_files_during_scan() {
        let temp_dir =
            std::env::temp_dir().join(format!("nghenhac_corrupt_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let corrupt_mp3 = temp_dir.join("01_Corrupt_Track.mp3");
        let zero_byte_flac = temp_dir.join("02_Empty_Track.flac");

        {
            let mut f1 = File::create(&corrupt_mp3).unwrap();
            f1.write_all(b"\xFF\xFF\x00\x12INVALIDHEADER").unwrap();

            let _f2 = File::create(&zero_byte_flac).unwrap();
        }

        let manager = LibraryManager::in_memory().expect("in memory manager");
        let scanned = manager
            .scan_directory(&temp_dir)
            .expect("scan should not abort on corrupt files");

        assert_eq!(scanned.len(), 2);
        assert_eq!(scanned[0].title, "Corrupt Track");
        assert_eq!(scanned[1].title, "Empty Track");

        let stats = manager.get_stats();
        assert_eq!(stats.total_tracks, 2);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_upsert_update_existing_track() {
        let manager = LibraryManager::in_memory().expect("in memory manager");
        let track_id = TrackId::new();
        let path = PathBuf::from("/music/update_test.mp3");

        let track_v1 = Track {
            id: track_id,
            title: "Original Title".to_string(),
            artist: "Original Artist".to_string(),
            album: "Original Album".to_string(),
            duration: Duration::from_secs(100),
            path: path.clone(),
            ..Default::default()
        };
        manager.upsert_track(&track_v1).unwrap();

        let track_v2 = Track {
            id: track_id,
            title: "Updated Title".to_string(),
            artist: "Updated Artist".to_string(),
            album: "Updated Album".to_string(),
            duration: Duration::from_secs(120),
            path,
            ..Default::default()
        };
        manager.upsert_track(&track_v2).unwrap();

        let fetched = manager.get_track_by_id(&track_id).unwrap().unwrap();
        assert_eq!(fetched.title, "Updated Title");
        assert_eq!(fetched.artist, "Updated Artist");
        assert_eq!(fetched.duration, Duration::from_secs(120));

        let all = manager.get_all_tracks().unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_get_track_by_nonexistent_id() {
        let manager = LibraryManager::in_memory().expect("in memory manager");
        let result = manager.get_track_by_id(&TrackId::new()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_save_playlist_sync() {
        let manager = LibraryManager::in_memory().expect("in memory manager");
        let pl = manager.create_playlist("My Playlist", None).unwrap();

        let t1 = TrackId::new();
        let t2 = TrackId::new();
        let t3 = TrackId::new();

        for (id, name) in [(t1, "T1"), (t2, "T2"), (t3, "T3")] {
            manager
                .upsert_track(&Track {
                    id,
                    title: name.to_string(),
                    path: PathBuf::from(format!("/music/{name}.mp3")),
                    ..Default::default()
                })
                .unwrap();
        }

        let mut updated_pl = pl;
        updated_pl.track_ids = vec![t3, t1, t2];
        manager.save_playlist(&updated_pl).unwrap();

        let playlists = manager.get_playlists().unwrap();
        assert_eq!(playlists[0].track_ids, vec![t3, t1, t2]);
    }

    #[test]
    fn test_thread_safety_concurrent_access() {
        let manager = LibraryManager::in_memory().expect("in memory manager");
        let mut handles = Vec::new();

        for i in 0..8 {
            let mgr = manager.clone();
            let handle = std::thread::spawn(move || {
                for j in 0..20 {
                    let id = TrackId::new();
                    let track = Track {
                        id,
                        title: format!("Thread {i} Track {j}"),
                        artist: format!("Artist {i}"),
                        album: format!("Album {i}"),
                        duration: Duration::from_secs(60 + j),
                        path: PathBuf::from(format!("/music/t_{i}_{j}.mp3")),
                        ..Default::default()
                    };
                    mgr.upsert_track(&track).unwrap();
                    let _ = mgr.get_stats();
                }
            });
            handles.push(handle);
        }

        for h in handles {
            h.join().expect("thread join");
        }

        let stats = manager.get_stats();
        assert_eq!(stats.total_tracks, 160);
    }

    #[test]
    fn test_backfill_missing_bit_depth_idempotency() {
        let manager = LibraryManager::in_memory().expect("in memory manager");
        let track_id = TrackId::new();
        let track = Track {
            id: track_id,
            title: "Old MP3 Song".to_string(),
            path: PathBuf::from("/music/old_song.mp3"),
            bit_depth: None,
            ..Default::default()
        };
        manager.upsert_track(&track).unwrap();

        // First backfill pass runs and marks 0 sentinel for missing/probed file
        let first_count = manager
            .with_db(|db| db.backfill_missing_bit_depth())
            .unwrap();
        assert_eq!(first_count, 1);

        // Second backfill pass finds 0 NULL rows -> 0 work done (idempotent O(1))
        let second_count = manager
            .with_db(|db| db.backfill_missing_bit_depth())
            .unwrap();
        assert_eq!(second_count, 0);
    }
}

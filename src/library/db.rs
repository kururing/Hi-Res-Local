//! SQLite persistence and query engine for local music library.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

use crate::app::{LibraryStats, Playlist, PlaylistId, Track, TrackId};
use crate::library::error::LibraryError;

/// SQLite database wrapper for library persistence.
pub struct LibraryDatabase {
    conn: Connection,
}

impl std::fmt::Debug for LibraryDatabase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LibraryDatabase").finish_non_exhaustive()
    }
}

impl LibraryDatabase {
    /// Opens or creates the SQLite database at the platform default location.
    pub fn open_default() -> Result<Self, LibraryError> {
        let path = default_db_path()?;
        Self::open(&path)
    }

    /// Opens or creates the SQLite database at a specific file path.
    pub fn open(path: &Path) -> Result<Self, LibraryError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let mut db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Opens an in-memory SQLite database (useful for unit tests).
    pub fn open_in_memory() -> Result<Self, LibraryError> {
        let conn = Connection::open_in_memory()?;
        let mut db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Initializes schema tables and indexes if they do not exist.
    pub fn init_schema(&mut self) -> Result<(), LibraryError> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                path TEXT NOT NULL UNIQUE,
                track_number INTEGER,
                disc_number INTEGER,
                year INTEGER,
                genre TEXT,
                sample_rate INTEGER,
                bitrate INTEGER,
                channels INTEGER,
                date_added TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
            CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);

            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, position),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks(playlist_id);
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id ON playlist_tracks(track_id);
            ",
        )?;
        Ok(())
    }

    /// Inserts or updates a single track in the database.
    pub fn upsert_track(&mut self, track: &Track) -> Result<(), LibraryError> {
        let duration_ms = track.duration.as_millis() as i64;
        let path_str = track.path.to_string_lossy().to_string();
        let date_added_str = track.date_added.to_rfc3339();

        self.conn.execute(
            "INSERT INTO tracks (
                id, title, artist, album, duration_ms, path,
                track_number, disc_number, year, genre,
                sample_rate, bitrate, channels, date_added
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14
            )
            ON CONFLICT(path) DO UPDATE SET
                id = excluded.id,
                title = excluded.title,
                artist = excluded.artist,
                album = excluded.album,
                duration_ms = excluded.duration_ms,
                track_number = excluded.track_number,
                disc_number = excluded.disc_number,
                year = excluded.year,
                genre = excluded.genre,
                sample_rate = excluded.sample_rate,
                bitrate = excluded.bitrate,
                channels = excluded.channels;",
            params![
                track.id.to_string(),
                track.title,
                track.artist,
                track.album,
                duration_ms,
                path_str,
                track.track_number.map(|v| v as i64),
                track.disc_number.map(|v| v as i64),
                track.year.map(|v| v as i64),
                track.genre,
                track.sample_rate.map(|v| v as i64),
                track.bitrate.map(|v| v as i64),
                track.channels.map(|v| v as i64),
                date_added_str,
            ],
        )?;

        Ok(())
    }

    /// Inserts or updates a batch of tracks within a single transaction.
    pub fn upsert_tracks_batch(&mut self, tracks: &[Track]) -> Result<(), LibraryError> {
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO tracks (
                    id, title, artist, album, duration_ms, path,
                    track_number, disc_number, year, genre,
                    sample_rate, bitrate, channels, date_added
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6,
                    ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14
                )
                ON CONFLICT(path) DO UPDATE SET
                    id = excluded.id,
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    duration_ms = excluded.duration_ms,
                    track_number = excluded.track_number,
                    disc_number = excluded.disc_number,
                    year = excluded.year,
                    genre = excluded.genre,
                    sample_rate = excluded.sample_rate,
                    bitrate = excluded.bitrate,
                    channels = excluded.channels;",
            )?;

            for track in tracks {
                let duration_ms = track.duration.as_millis() as i64;
                let path_str = track.path.to_string_lossy().to_string();
                let date_added_str = track.date_added.to_rfc3339();

                stmt.execute(params![
                    track.id.to_string(),
                    track.title,
                    track.artist,
                    track.album,
                    duration_ms,
                    path_str,
                    track.track_number.map(|v| v as i64),
                    track.disc_number.map(|v| v as i64),
                    track.year.map(|v| v as i64),
                    track.genre,
                    track.sample_rate.map(|v| v as i64),
                    track.bitrate.map(|v| v as i64),
                    track.channels.map(|v| v as i64),
                    date_added_str,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Deletes stale tracks from the database that reside under `base_dir` but were not found during scan.
    pub fn cleanup_stale_tracks_in_dir(
        &mut self,
        base_dir: &Path,
        active_paths: &HashSet<PathBuf>,
    ) -> Result<usize, LibraryError> {
        let all_tracks = self.get_all_tracks()?;
        let mut stale_ids = Vec::new();

        let canonical_base = base_dir
            .canonicalize()
            .unwrap_or_else(|_| base_dir.to_path_buf());

        for track in all_tracks {
            let canonical_track_path = track
                .path
                .canonicalize()
                .unwrap_or_else(|_| track.path.clone());

            let is_under_dir = canonical_track_path.starts_with(&canonical_base)
                || track.path.starts_with(base_dir);

            if is_under_dir {
                let is_active = active_paths.contains(&track.path)
                    || active_paths.contains(&canonical_track_path);

                if !is_active {
                    stale_ids.push(track.id);
                }
            }
        }

        if stale_ids.is_empty() {
            return Ok(0);
        }

        let count = stale_ids.len();
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached("DELETE FROM tracks WHERE id = ?1")?;
            for id in stale_ids {
                stmt.execute(params![id.to_string()])?;
            }
        }
        tx.commit()?;

        Ok(count)
    }

    /// Retrieves all indexed tracks ordered by artist, album, track number, and title.
    pub fn get_all_tracks(&self) -> Result<Vec<Track>, LibraryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, artist, album, duration_ms, path,
                    track_number, disc_number, year, genre,
                    sample_rate, bitrate, channels, date_added
             FROM tracks
             ORDER BY artist COLLATE NOCASE ASC, album COLLATE NOCASE ASC, track_number ASC, title COLLATE NOCASE ASC",
        )?;

        let track_iter = stmt.query_map([], |row| row_to_track(row))?;
        let mut tracks = Vec::new();
        for track_res in track_iter {
            tracks.push(track_res?);
        }
        Ok(tracks)
    }

    /// Retrieves a single track by its unique ID.
    pub fn get_track_by_id(&self, id: &TrackId) -> Result<Option<Track>, LibraryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, artist, album, duration_ms, path,
                    track_number, disc_number, year, genre,
                    sample_rate, bitrate, channels, date_added
             FROM tracks
             WHERE id = ?1",
        )?;

        let track = stmt
            .query_row(params![id.to_string()], |row| row_to_track(row))
            .optional()?;

        Ok(track)
    }

    /// Computes summary statistics for the indexed library.
    pub fn get_stats(&self) -> Result<LibraryStats, LibraryError> {
        let total_tracks: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .unwrap_or(0);

        let total_artists: usize = self
            .conn
            .query_row(
                "SELECT COUNT(DISTINCT artist) FROM tracks WHERE artist != 'Unknown Artist'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_albums: usize = self
            .conn
            .query_row(
                "SELECT COUNT(DISTINCT album) FROM tracks WHERE album != 'Unknown Album'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_duration_ms: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(duration_ms), 0) FROM tracks",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_duration_secs = if total_duration_ms > 0 {
            (total_duration_ms / 1000) as u64
        } else {
            0
        };

        Ok(LibraryStats {
            total_tracks,
            total_artists,
            total_albums,
            total_duration_secs,
        })
    }

    /// Creates a new playlist.
    pub fn create_playlist(
        &mut self,
        name: &str,
        description: Option<&str>,
    ) -> Result<Playlist, LibraryError> {
        let id = PlaylistId::new();
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        self.conn.execute(
            "INSERT INTO playlists (id, name, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id.to_string(), name, description, now_str, now_str],
        )?;

        Ok(Playlist {
            id,
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            track_ids: Vec::new(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Deletes a playlist by ID (cascades to playlist_tracks).
    pub fn delete_playlist(&mut self, id: &PlaylistId) -> Result<(), LibraryError> {
        self.conn.execute(
            "DELETE FROM playlists WHERE id = ?1",
            params![id.to_string()],
        )?;
        Ok(())
    }

    /// Retrieves all playlists with their ordered track IDs.
    pub fn get_playlists(&self) -> Result<Vec<Playlist>, LibraryError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, created_at, updated_at
             FROM playlists
             ORDER BY name COLLATE NOCASE ASC",
        )?;

        let playlist_rows = stmt.query_map([], |row| {
            let id_str: String = row.get(0)?;
            let name: String = row.get(1)?;
            let description: Option<String> = row.get(2)?;
            let created_at_str: String = row.get(3)?;
            let updated_at_str: String = row.get(4)?;

            let uuid = Uuid::parse_str(&id_str).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;

            let created_at = DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            let updated_at = DateTime::parse_from_rfc3339(&updated_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            Ok((PlaylistId(uuid), name, description, created_at, updated_at))
        })?;

        let mut playlists = Vec::new();
        for row_res in playlist_rows {
            let (id, name, description, created_at, updated_at) = row_res?;

            // Fetch ordered track IDs for this playlist
            let mut track_stmt = self.conn.prepare(
                "SELECT track_id FROM playlist_tracks
                 WHERE playlist_id = ?1
                 ORDER BY position ASC",
            )?;

            let track_rows = track_stmt.query_map(params![id.to_string()], |t_row| {
                let track_id_str: String = t_row.get(0)?;
                let track_uuid = Uuid::parse_str(&track_id_str).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        0,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?;
                Ok(TrackId(track_uuid))
            })?;

            let mut track_ids = Vec::new();
            for tr_res in track_rows {
                track_ids.push(tr_res?);
            }

            playlists.push(Playlist {
                id,
                name,
                description,
                track_ids,
                created_at,
                updated_at,
            });
        }

        Ok(playlists)
    }

    /// Appends a track to a playlist.
    pub fn add_track_to_playlist(
        &mut self,
        playlist_id: &PlaylistId,
        track_id: &TrackId,
    ) -> Result<(), LibraryError> {
        let max_pos: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id.to_string()],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        let next_pos = max_pos + 1;
        let now_str = Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position)
             VALUES (?1, ?2, ?3)",
            params![playlist_id.to_string(), track_id.to_string(), next_pos],
        )?;

        self.conn.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now_str, playlist_id.to_string()],
        )?;

        Ok(())
    }

    /// Removes a track from a playlist and reindexes remaining track positions.
    pub fn remove_track_from_playlist(
        &mut self,
        playlist_id: &PlaylistId,
        track_id: &TrackId,
    ) -> Result<(), LibraryError> {
        let tx = self.conn.transaction()?;
        {
            tx.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
                params![playlist_id.to_string(), track_id.to_string()],
            )?;

            // Reindex positions
            let mut fetch_stmt = tx.prepare(
                "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
            )?;
            let track_rows = fetch_stmt.query_map(params![playlist_id.to_string()], |row| {
                let tid: String = row.get(0)?;
                Ok(tid)
            })?;

            let mut remaining_ids = Vec::new();
            for tid_res in track_rows {
                remaining_ids.push(tid_res?);
            }

            tx.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id.to_string()],
            )?;

            let mut insert_stmt = tx.prepare(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            )?;
            for (pos, tid) in remaining_ids.iter().enumerate() {
                insert_stmt.execute(params![playlist_id.to_string(), tid, pos as i64])?;
            }

            let now_str = Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
                params![now_str, playlist_id.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Saves or updates a playlist and completely synchronizes its track order.
    pub fn save_playlist(&mut self, playlist: &Playlist) -> Result<(), LibraryError> {
        let tx = self.conn.transaction()?;
        {
            let created_at_str = playlist.created_at.to_rfc3339();
            let updated_at_str = playlist.updated_at.to_rfc3339();

            tx.execute(
                "INSERT INTO playlists (id, name, description, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    updated_at = excluded.updated_at;",
                params![
                    playlist.id.to_string(),
                    playlist.name,
                    playlist.description,
                    created_at_str,
                    updated_at_str
                ],
            )?;

            tx.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist.id.to_string()],
            )?;

            let mut insert_stmt = tx.prepare(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            )?;

            for (pos, track_id) in playlist.track_ids.iter().enumerate() {
                insert_stmt.execute(params![
                    playlist.id.to_string(),
                    track_id.to_string(),
                    pos as i64
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

/// Helper function to convert a SQLite row into a [`Track`] struct.
fn row_to_track(row: &rusqlite::Row<'_>) -> Result<Track, rusqlite::Error> {
    let id_str: String = row.get(0)?;
    let title: String = row.get(1)?;
    let artist: String = row.get(2)?;
    let album: String = row.get(3)?;
    let duration_ms: i64 = row.get(4)?;
    let path_str: String = row.get(5)?;
    let track_number: Option<i64> = row.get(6)?;
    let disc_number: Option<i64> = row.get(7)?;
    let year: Option<i64> = row.get(8)?;
    let genre: Option<String> = row.get(9)?;
    let sample_rate: Option<i64> = row.get(10)?;
    let bitrate: Option<i64> = row.get(11)?;
    let channels: Option<i64> = row.get(12)?;
    let date_added_str: String = row.get(13)?;

    let uuid = Uuid::parse_str(&id_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;

    let date_added = DateTime::parse_from_rfc3339(&date_added_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    Ok(Track {
        id: TrackId(uuid),
        title,
        artist,
        album,
        duration: Duration::from_millis(duration_ms.max(0) as u64),
        path: PathBuf::from(path_str),
        track_number: track_number.map(|v| v as u32),
        disc_number: disc_number.map(|v| v as u32),
        year: year.map(|v| v as u32),
        genre,
        sample_rate: sample_rate.map(|v| v as u32),
        bitrate: bitrate.map(|v| v as u32),
        channels: channels.map(|v| v as u16),
        date_added,
    })
}

/// Resolves the platform-specific library SQLite database path.
pub fn default_db_path() -> Result<PathBuf, LibraryError> {
    let proj_dirs = directories::ProjectDirs::from("com", "nghenhacpromax", "nghenhacpromax")
        .ok_or(LibraryError::DataDirectoryUnavailable)?;
    let data_dir = proj_dirs.data_local_dir();
    Ok(data_dir.join("library.db"))
}

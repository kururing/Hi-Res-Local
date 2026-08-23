pub const SCHEMA_V1: &str = r#"
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
);

-- Library root directories monitored for audio files
CREATE TABLE IF NOT EXISTS library_roots (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL
);

-- Tracks collection
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album_artist TEXT,
    album TEXT NOT NULL,
    genre TEXT,
    year INTEGER,
    track_number INTEGER,
    disc_number INTEGER,
    duration_ms INTEGER NOT NULL,
    bitrate INTEGER,
    sample_rate INTEGER,
    channels INTEGER,
    format TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_modified_at TEXT NOT NULL,
    date_added TEXT NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 0,
    play_count INTEGER NOT NULL DEFAULT 0,
    skip_count INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    cover_art_path TEXT,
    lyrics TEXT,
    has_synced_lyrics INTEGER NOT NULL DEFAULT 0,
    is_corrupt INTEGER NOT NULL DEFAULT 0,
    corrupt_reason TEXT,
    duplicate_group_id TEXT,
    is_primary INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks(album_artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
CREATE INDEX IF NOT EXISTS idx_tracks_rating ON tracks(rating);
CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_duplicate_group ON tracks(duplicate_group_id);

-- Artist favorites and custom metadata override
CREATE TABLE IF NOT EXISTS favorite_artists (
    artist_name TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL
);

-- Album favorites and custom metadata override
CREATE TABLE IF NOT EXISTS favorite_albums (
    album_key TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
    album_title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- User playlists
CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_smart INTEGER NOT NULL DEFAULT 0,
    rules_json TEXT,
    cover_art_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Playlist track mapping with explicit ordering
CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (playlist_id, position),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);

-- Play history / playback telemetry
CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    played_at TEXT NOT NULL,
    completed_duration_ms INTEGER NOT NULL,
    fully_played INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);
CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);

-- Key-value settings table
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

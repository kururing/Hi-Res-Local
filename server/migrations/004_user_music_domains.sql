-- User music domains: playlists, favorites, play history, lyrics cache.
-- Cloud playlist membership forbids duplicate tracks (retry-safe add).
-- Positions are unique per playlist. Smart rules are stored, not evaluated.

CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_smart BOOLEAN NOT NULL DEFAULT FALSE,
  rules_json TEXT,
  cover_art_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT playlists_name_length CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT playlists_description_length CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT playlists_rules_length CHECK (rules_json IS NULL OR char_length(rules_json) <= 8000),
  CONSTRAINT playlists_cover_length CHECK (cover_art_path IS NULL OR char_length(cover_art_path) <= 2048)
);

CREATE TABLE playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (playlist_id, track_id),
  CONSTRAINT playlist_tracks_position_nonneg CHECK (position >= 0)
);

CREATE TABLE user_favorite_tracks (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE user_favorite_albums (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  album_id UUID NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, album_id)
);

CREATE TABLE user_favorite_artists (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, artist_id)
);

CREATE TABLE play_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  completed_duration_ms INTEGER NOT NULL,
  fully_played BOOLEAN NOT NULL DEFAULT FALSE,
  client_request_id TEXT,
  CONSTRAINT play_history_duration_nonneg CHECK (completed_duration_ms >= 0),
  CONSTRAINT play_history_request_id_length CHECK (
    client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 128
  )
);

CREATE TABLE track_lyrics (
  track_id UUID PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  provider TEXT,
  synced_lrc TEXT,
  plain_text TEXT,
  lines_json JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  expires_at TIMESTAMPTZ NOT NULL,
  attribution TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  is_synced BOOLEAN NOT NULL DEFAULT FALSE,
  instrumental BOOLEAN NOT NULL DEFAULT FALSE,
  lyric_offset INTEGER,
  CONSTRAINT track_lyrics_status_check CHECK (status IN ('found', 'instrumental', 'not_found')),
  CONSTRAINT track_lyrics_synced_length CHECK (synced_lrc IS NULL OR char_length(synced_lrc) <= 200000),
  CONSTRAINT track_lyrics_plain_length CHECK (plain_text IS NULL OR char_length(plain_text) <= 200000)
);

CREATE INDEX idx_playlists_user_updated ON playlists (user_id, updated_at DESC);
CREATE UNIQUE INDEX idx_playlist_tracks_position ON playlist_tracks (playlist_id, position);
CREATE INDEX idx_playlist_tracks_playlist_position ON playlist_tracks (playlist_id, position);
CREATE INDEX idx_user_favorite_tracks_user ON user_favorite_tracks (user_id, created_at DESC);
CREATE INDEX idx_user_favorite_albums_user ON user_favorite_albums (user_id, created_at DESC);
CREATE INDEX idx_user_favorite_artists_user ON user_favorite_artists (user_id, created_at DESC);
CREATE INDEX idx_play_history_user_played ON play_history (user_id, played_at DESC, id DESC);
CREATE INDEX idx_play_history_user_track ON play_history (user_id, track_id);
CREATE UNIQUE INDEX idx_play_history_user_request
  ON play_history (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX idx_track_lyrics_expires ON track_lyrics (expires_at);

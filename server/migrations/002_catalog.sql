CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT artists_name_length CHECK (char_length(name) BETWEEN 1 AND 200)
);

CREATE TABLE albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  primary_artist_id UUID REFERENCES artists (id) ON DELETE SET NULL,
  year INTEGER,
  genre TEXT,
  cover_art_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT albums_title_length CHECK (char_length(title) BETWEEN 1 AND 300),
  CONSTRAINT albums_year_range CHECK (year IS NULL OR year BETWEEN 1000 AND 9999)
);

CREATE TABLE tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  album_id UUID REFERENCES albums (id) ON DELETE SET NULL,
  track_number INTEGER,
  disc_number INTEGER,
  duration_seconds NUMERIC(12, 3) NOT NULL,
  genre TEXT,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT tracks_title_length CHECK (char_length(title) BETWEEN 1 AND 300),
  CONSTRAINT tracks_duration_positive CHECK (duration_seconds > 0)
);

CREATE TABLE track_artists (
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, artist_id)
);

CREATE TABLE audio_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  container TEXT NOT NULL,
  codec TEXT NOT NULL,
  sample_rate_hz INTEGER NOT NULL,
  bit_depth INTEGER,
  channels INTEGER NOT NULL,
  bitrate_kbps INTEGER,
  duration_seconds NUMERIC(12, 3) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  checksum TEXT NOT NULL,
  is_lossless BOOLEAN NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT audio_assets_storage_key_length CHECK (char_length(storage_key) BETWEEN 1 AND 1024),
  CONSTRAINT audio_assets_sample_rate_positive CHECK (sample_rate_hz > 0),
  CONSTRAINT audio_assets_channels_positive CHECK (channels > 0),
  CONSTRAINT audio_assets_file_size_positive CHECK (file_size_bytes > 0)
);

CREATE INDEX idx_artists_sort_name ON artists (sort_name, id);
CREATE INDEX idx_artists_name_trgm ON artists USING gin (name gin_trgm_ops);
CREATE INDEX idx_albums_title_sort ON albums (lower(title), id);
CREATE INDEX idx_albums_title_trgm ON albums USING gin (title gin_trgm_ops);
CREATE INDEX idx_albums_primary_artist ON albums (primary_artist_id);
CREATE INDEX idx_tracks_title_sort ON tracks (lower(title), id);
CREATE INDEX idx_tracks_title_trgm ON tracks USING gin (title gin_trgm_ops);
CREATE INDEX idx_tracks_album_id ON tracks (album_id);
CREATE INDEX idx_tracks_available ON tracks (available);
CREATE INDEX idx_track_artists_artist_id ON track_artists (artist_id);
CREATE INDEX idx_audio_assets_track_available ON audio_assets (track_id) WHERE available = TRUE;
CREATE UNIQUE INDEX idx_audio_assets_storage_key ON audio_assets (storage_key);

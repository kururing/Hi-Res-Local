-- Zero-input import: identifiers, shared unknown records, duplicate status.

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS musicbrainz_artist_id TEXT,
  ADD COLUMN IF NOT EXISTS placeholder_kind TEXT;

ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS musicbrainz_album_id TEXT,
  ADD COLUMN IF NOT EXISTS upc TEXT,
  ADD COLUMN IF NOT EXISTS placeholder_kind TEXT;

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS isrc TEXT,
  ADD COLUMN IF NOT EXISTS musicbrainz_track_id TEXT;

ALTER TABLE artists
  DROP CONSTRAINT IF EXISTS artists_mbid_length,
  ADD CONSTRAINT artists_mbid_length CHECK (
    musicbrainz_artist_id IS NULL OR char_length(musicbrainz_artist_id) BETWEEN 1 AND 64
  );

ALTER TABLE albums
  DROP CONSTRAINT IF EXISTS albums_mbid_length,
  ADD CONSTRAINT albums_mbid_length CHECK (
    musicbrainz_album_id IS NULL OR char_length(musicbrainz_album_id) BETWEEN 1 AND 64
  ),
  DROP CONSTRAINT IF EXISTS albums_upc_length,
  ADD CONSTRAINT albums_upc_length CHECK (
    upc IS NULL OR char_length(upc) BETWEEN 8 AND 18
  );

ALTER TABLE tracks
  DROP CONSTRAINT IF EXISTS tracks_isrc_length,
  ADD CONSTRAINT tracks_isrc_length CHECK (
    isrc IS NULL OR char_length(isrc) BETWEEN 8 AND 15
  ),
  DROP CONSTRAINT IF EXISTS tracks_mbid_length,
  ADD CONSTRAINT tracks_mbid_length CHECK (
    musicbrainz_track_id IS NULL OR char_length(musicbrainz_track_id) BETWEEN 1 AND 64
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_musicbrainz
  ON artists (musicbrainz_artist_id)
  WHERE musicbrainz_artist_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_placeholder
  ON artists (placeholder_kind)
  WHERE placeholder_kind IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_musicbrainz
  ON albums (musicbrainz_album_id)
  WHERE musicbrainz_album_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_upc
  ON albums (upc)
  WHERE upc IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_placeholder
  ON albums (placeholder_kind)
  WHERE placeholder_kind IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_isrc
  ON tracks (isrc)
  WHERE isrc IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_musicbrainz
  ON tracks (musicbrainz_track_id)
  WHERE musicbrainz_track_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE audio_imports DROP CONSTRAINT IF EXISTS audio_imports_status_check;
ALTER TABLE audio_imports
  ADD CONSTRAINT audio_imports_status_check CHECK (
    status IN (
      'waiting_upload',
      'uploading',
      'verifying',
      'probing',
      'needs_review',
      'ready',
      'publishing',
      'published',
      'duplicate',
      'failed',
      'cancelled'
    )
  );

INSERT INTO artists (id, name, sort_name, placeholder_kind)
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'Nghệ sĩ không xác định',
  'nghe si khong xac dinh',
  'unknown_artist'
)
ON CONFLICT DO NOTHING;

INSERT INTO albums (id, title, primary_artist_id, placeholder_kind)
VALUES (
  '00000000-0000-4000-a000-000000000002',
  'Album không xác định',
  '00000000-0000-4000-a000-000000000001',
  'unknown_album'
)
ON CONFLICT DO NOTHING;

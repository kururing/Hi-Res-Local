-- Upload-first audio imports. Additive: keeps track/album/artist upload flow.

CREATE TABLE audio_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  upload_id UUID REFERENCES media_uploads (id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  expected_mime TEXT NOT NULL,
  expected_size_bytes BIGINT NOT NULL,
  expected_checksum_sha256 TEXT NOT NULL,
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  status TEXT NOT NULL,
  detected_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  override_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  committed_track_id UUID REFERENCES tracks (id) ON DELETE SET NULL,
  committed_album_id UUID REFERENCES albums (id) ON DELETE SET NULL,
  committed_artist_id UUID REFERENCES artists (id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  idempotency_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT audio_imports_filename_length CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  CONSTRAINT audio_imports_mime_length CHECK (char_length(expected_mime) BETWEEN 1 AND 127),
  CONSTRAINT audio_imports_size_positive CHECK (expected_size_bytes > 0),
  CONSTRAINT audio_imports_checksum_length CHECK (char_length(expected_checksum_sha256) = 64),
  CONSTRAINT audio_imports_object_key_length CHECK (char_length(object_key) BETWEEN 1 AND 1024),
  CONSTRAINT audio_imports_status_check CHECK (
    status IN (
      'waiting_upload',
      'uploading',
      'verifying',
      'probing',
      'needs_review',
      'ready',
      'publishing',
      'published',
      'failed',
      'cancelled'
    )
  )
);

CREATE INDEX idx_audio_imports_owner_created ON audio_imports (owner_id, created_at DESC);
CREATE INDEX idx_audio_imports_status_updated ON audio_imports (status, updated_at);
CREATE UNIQUE INDEX idx_audio_imports_object_key ON audio_imports (object_key);
CREATE UNIQUE INDEX idx_audio_imports_idempotency
  ON audio_imports (owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_audio_imports_owner_checksum
  ON audio_imports (owner_id, expected_checksum_sha256)
  WHERE status <> 'cancelled';

ALTER TABLE media_uploads DROP CONSTRAINT media_uploads_entity_type_check;
ALTER TABLE media_uploads
  ADD CONSTRAINT media_uploads_entity_type_check
  CHECK (entity_type IN ('track', 'album', 'artist', 'import'));

CREATE UNIQUE INDEX idx_audio_assets_available_checksum
  ON audio_assets (checksum)
  WHERE available = TRUE;

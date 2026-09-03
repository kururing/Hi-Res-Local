-- Ingestion, rights, artwork, and catalog publication.
-- Track publication, upload status, and audio-asset availability are separate columns.

CREATE TABLE media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  object_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  expected_filename TEXT NOT NULL,
  expected_mime TEXT NOT NULL,
  expected_size_bytes BIGINT NOT NULL,
  expected_checksum_sha256 TEXT NOT NULL,
  actual_size_bytes BIGINT,
  actual_checksum_sha256 TEXT,
  status TEXT NOT NULL,
  presign_expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT media_uploads_media_type_check CHECK (media_type IN ('audio', 'artwork')),
  CONSTRAINT media_uploads_entity_type_check CHECK (entity_type IN ('track', 'album', 'artist')),
  CONSTRAINT media_uploads_status_check CHECK (
    status IN ('upload_pending', 'uploaded', 'failed', 'cancelled')
  ),
  CONSTRAINT media_uploads_filename_length CHECK (char_length(expected_filename) BETWEEN 1 AND 255),
  CONSTRAINT media_uploads_object_key_length CHECK (char_length(object_key) BETWEEN 1 AND 1024),
  CONSTRAINT media_uploads_size_positive CHECK (expected_size_bytes > 0),
  CONSTRAINT media_uploads_checksum_length CHECK (char_length(expected_checksum_sha256) = 64)
);

CREATE UNIQUE INDEX idx_media_uploads_object_key ON media_uploads (object_key);
CREATE UNIQUE INDEX idx_media_uploads_idempotency
  ON media_uploads (owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_media_uploads_entity ON media_uploads (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_media_uploads_status_expires ON media_uploads (status, presign_expires_at);

CREATE TABLE ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT ingestion_jobs_type_check CHECK (job_type IN ('audio_probe', 'artwork_process')),
  CONSTRAINT ingestion_jobs_status_check CHECK (
    status IN ('pending', 'probing', 'ready', 'failed', 'cancelled')
  ),
  CONSTRAINT ingestion_jobs_attempts_nonneg CHECK (attempts >= 0)
);

CREATE INDEX idx_ingestion_jobs_claim
  ON ingestion_jobs (status, available_at, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_ingestion_jobs_upload ON ingestion_jobs (upload_id);

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  request_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT admin_audit_action_length CHECK (char_length(action) BETWEEN 1 AND 80),
  CONSTRAINT admin_audit_entity_type_length CHECK (char_length(entity_type) BETWEEN 1 AND 40)
);

CREATE INDEX idx_admin_audit_admin_created ON admin_audit_log (admin_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_entity ON admin_audit_log (entity_type, entity_id, created_at DESC);

CREATE TABLE artwork_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  source_upload_id UUID REFERENCES media_uploads (id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  original_object_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  checksum_sha256 TEXT,
  variants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_url TEXT,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT artwork_assets_entity_type_check CHECK (entity_type IN ('album', 'artist')),
  CONSTRAINT artwork_assets_status_check CHECK (status IN ('pending', 'ready', 'failed')),
  CONSTRAINT artwork_assets_key_length CHECK (char_length(original_object_key) BETWEEN 1 AND 1024)
);

CREATE INDEX idx_artwork_assets_entity ON artwork_assets (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_artwork_assets_available
  ON artwork_assets (entity_type, entity_id)
  WHERE available = TRUE;

CREATE TABLE track_rights (
  track_id UUID PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
  rights_holder TEXT NOT NULL,
  license_source_ref TEXT NOT NULL,
  territory_scope TEXT,
  attested BOOLEAN NOT NULL DEFAULT FALSE,
  attested_by UUID REFERENCES users (id) ON DELETE SET NULL,
  attested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT track_rights_holder_length CHECK (char_length(rights_holder) BETWEEN 1 AND 200),
  CONSTRAINT track_rights_source_length CHECK (char_length(license_source_ref) BETWEEN 1 AND 500),
  CONSTRAINT track_rights_territory_length CHECK (
    territory_scope IS NULL OR char_length(territory_scope) BETWEEN 1 AND 120
  ),
  CONSTRAINT track_rights_attested_complete CHECK (
    attested = FALSE
    OR (attested_by IS NOT NULL AND attested_at IS NOT NULL)
  )
);

ALTER TABLE tracks
  ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE tracks
  ADD CONSTRAINT tracks_publication_state_check
  CHECK (publication_state IN ('draft', 'published'));

ALTER TABLE tracks DROP CONSTRAINT tracks_duration_positive;
ALTER TABLE tracks
  ADD CONSTRAINT tracks_duration_nonneg CHECK (duration_seconds >= 0);

ALTER TABLE audio_assets
  ADD COLUMN mime_type TEXT,
  ADD COLUMN validation_state TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN source_upload_id UUID REFERENCES media_uploads (id) ON DELETE SET NULL;

ALTER TABLE audio_assets
  ADD CONSTRAINT audio_assets_validation_state_check
  CHECK (validation_state IN ('pending', 'probing', 'ready', 'failed', 'cancelled'));

CREATE INDEX idx_tracks_publication_state ON tracks (publication_state)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_audio_assets_validation ON audio_assets (track_id, validation_state, available);

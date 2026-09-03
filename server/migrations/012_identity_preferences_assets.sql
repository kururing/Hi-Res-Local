-- Identity, RBAC, portable preferences, and first-class audio asset quality fields.

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_known;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_known CHECK (role IN ('admin', 'catalog_admin'));

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT user_preferences_schema_version_positive CHECK (schema_version >= 1),
  CONSTRAINT user_preferences_revision_positive CHECK (revision >= 1)
);

ALTER TABLE audio_assets
  ADD COLUMN IF NOT EXISTS hi_res BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_dsd BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dsd_rate INTEGER,
  ADD COLUMN IF NOT EXISTS replaygain_track_gain DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS replaygain_track_peak DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS replaygain_album_gain DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS replaygain_album_peak DOUBLE PRECISION;

ALTER TABLE audio_assets DROP CONSTRAINT IF EXISTS audio_assets_dsd_rate_known;
ALTER TABLE audio_assets
  ADD CONSTRAINT audio_assets_dsd_rate_known
  CHECK (dsd_rate IS NULL OR dsd_rate IN (64, 128, 256, 512));

UPDATE audio_assets
SET
  is_dsd = (
    lower(codec) IN ('dsd', 'dsd_lsbf', 'dsd_msbf', 'dsd_lsbf_planar', 'dst')
    OR lower(container) IN ('dsf', 'dff')
    OR lower(codec) LIKE 'dsd%'
  ),
  hi_res = CASE
    WHEN (
      lower(codec) IN ('dsd', 'dsd_lsbf', 'dsd_msbf', 'dsd_lsbf_planar', 'dst')
      OR lower(container) IN ('dsf', 'dff')
      OR lower(codec) LIKE 'dsd%'
    ) THEN TRUE
    ELSE is_lossless AND (sample_rate_hz > 48000 OR COALESCE(bit_depth, 0) > 16)
  END,
  dsd_rate = CASE
    WHEN sample_rate_hz IN (2822400, 3072000) THEN 64
    WHEN sample_rate_hz IN (5644800, 6144000) THEN 128
    WHEN sample_rate_hz IN (11289600, 12288000) THEN 256
    WHEN sample_rate_hz IN (22579200, 24576000) THEN 512
    ELSE NULL
  END
WHERE TRUE;

-- MQA catalog fields and DSD1024.

ALTER TABLE audio_assets
  ADD COLUMN IF NOT EXISTS is_mqa BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mqa_status TEXT,
  ADD COLUMN IF NOT EXISTS mqa_orig_sample_rate INTEGER;

ALTER TABLE audio_assets DROP CONSTRAINT IF EXISTS audio_assets_dsd_rate_known;
ALTER TABLE audio_assets
  ADD CONSTRAINT audio_assets_dsd_rate_known
  CHECK (dsd_rate IS NULL OR dsd_rate IN (64, 128, 256, 512, 1024));

ALTER TABLE audio_assets DROP CONSTRAINT IF EXISTS audio_assets_mqa_status_known;
ALTER TABLE audio_assets
  ADD CONSTRAINT audio_assets_mqa_status_known
  CHECK (mqa_status IS NULL OR mqa_status IN ('mqa', 'mqa_studio', 'mqa_authenticated'));

UPDATE audio_assets
SET dsd_rate = 1024
WHERE sample_rate_hz IN (45158400, 49152000);

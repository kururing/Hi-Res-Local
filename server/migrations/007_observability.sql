ALTER TABLE ingestion_jobs
  ADD COLUMN request_id TEXT;

CREATE INDEX idx_ingestion_jobs_request_id
  ON ingestion_jobs (request_id)
  WHERE request_id IS NOT NULL;

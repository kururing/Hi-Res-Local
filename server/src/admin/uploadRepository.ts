import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';

export type MediaType = 'audio' | 'artwork';
export type UploadStatus = 'upload_pending' | 'uploaded' | 'failed' | 'cancelled';
export type JobStatus = 'pending' | 'probing' | 'ready' | 'failed' | 'cancelled';
export type JobType = 'audio_probe' | 'artwork_process';

export interface MediaUploadRow {
  id: string;
  owner_id: string;
  media_type: MediaType;
  entity_type: string;
  entity_id: string;
  object_key: string;
  bucket: string;
  expected_filename: string;
  expected_mime: string;
  expected_size_bytes: string | number;
  expected_checksum_sha256: string;
  actual_size_bytes: string | number | null;
  actual_checksum_sha256: string | null;
  status: UploadStatus;
  presign_expires_at: Date | string;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface IngestionJobRow {
  id: string;
  upload_id: string;
  job_type: JobType;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  available_at: Date | string;
  locked_by: string | null;
  locked_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  request_id?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class UploadRepository {
  constructor(private readonly db: Queryable) {}

  async insertUpload(input: {
    id: string;
    ownerId: string;
    mediaType: MediaType;
    entityType: string;
    entityId: string;
    objectKey: string;
    bucket: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    checksum: string;
    status: UploadStatus;
    presignExpiresAt: Date;
    idempotencyKey: string | null;
  }): Promise<MediaUploadRow> {
    const result = await query<MediaUploadRow>(this.db, `
      INSERT INTO media_uploads (
        id, owner_id, media_type, entity_type, entity_id, object_key, bucket,
        expected_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        status, presign_expires_at, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      input.id, input.ownerId, input.mediaType, input.entityType, input.entityId,
      input.objectKey, input.bucket, input.filename, input.mime, input.sizeBytes,
      input.checksum, input.status, input.presignExpiresAt.toISOString(), input.idempotencyKey,
    ]);
    return result.rows[0]!;
  }

  async findByIdempotency(ownerId: string, key: string): Promise<MediaUploadRow | null> {
    const result = await query<MediaUploadRow>(this.db, `
      SELECT * FROM media_uploads WHERE owner_id = $1 AND idempotency_key = $2
    `, [ownerId, key]);
    return result.rows[0] ?? null;
  }

  async findLatestByEntity(entityType: string, entityId: string): Promise<MediaUploadRow | null> {
    const result = await query<MediaUploadRow>(this.db, `
      SELECT * FROM media_uploads
      WHERE entity_type = $1 AND entity_id = $2 AND status <> 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1
    `, [entityType, entityId]);
    return result.rows[0] ?? null;
  }

  async getByObjectKey(objectKey: string): Promise<MediaUploadRow | null> {
    const result = await query<MediaUploadRow>(this.db, 'SELECT * FROM media_uploads WHERE object_key = $1', [objectKey]);
    return result.rows[0] ?? null;
  }

  async getUpload(id: string): Promise<MediaUploadRow | null> {
    const result = await query<MediaUploadRow>(this.db, 'SELECT * FROM media_uploads WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async getUploadForUpdate(id: string): Promise<MediaUploadRow | null> {
    const result = await query<MediaUploadRow>(this.db, 'SELECT * FROM media_uploads WHERE id = $1 FOR UPDATE', [id]);
    return result.rows[0] ?? null;
  }

  async markUploaded(id: string, actualSize: number, actualChecksum: string | null): Promise<void> {
    await query(this.db, `
      UPDATE media_uploads
      SET status = 'uploaded',
          actual_size_bytes = $2,
          actual_checksum_sha256 = $3,
          completed_at = timezone('utc', now()),
          error_code = NULL,
          error_message = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [id, actualSize, actualChecksum]);
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    await query(this.db, `
      UPDATE media_uploads
      SET status = 'failed', error_code = $2, error_message = $3, updated_at = timezone('utc', now())
      WHERE id = $1
    `, [id, code, message]);
  }

  async markCancelled(id: string): Promise<void> {
    await query(this.db, `
      UPDATE media_uploads
      SET status = 'cancelled',
          cancelled_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [id]);
  }

  async insertJob(input: {
    id: string;
    uploadId: string;
    jobType: JobType;
    requestId?: string | null;
  }): Promise<IngestionJobRow> {
    const result = await query<IngestionJobRow>(this.db, `
      INSERT INTO ingestion_jobs (id, upload_id, job_type, status, request_id)
      VALUES ($1, $2, $3, 'pending', $4)
      RETURNING *
    `, [input.id, input.uploadId, input.jobType, input.requestId ?? null]);
    return result.rows[0]!;
  }

  async getLatestJob(uploadId: string): Promise<IngestionJobRow | null> {
    const result = await query<IngestionJobRow>(this.db, `
      SELECT * FROM ingestion_jobs WHERE upload_id = $1 ORDER BY created_at DESC LIMIT 1
    `, [uploadId]);
    return result.rows[0] ?? null;
  }

  async cancelJobs(uploadId: string): Promise<void> {
    await query(this.db, `
      UPDATE ingestion_jobs
      SET status = 'cancelled', updated_at = timezone('utc', now())
      WHERE upload_id = $1 AND status IN ('pending', 'probing', 'failed')
    `, [uploadId]);
  }

  async resetJobForRetry(jobId: string): Promise<IngestionJobRow | null> {
    const result = await query<IngestionJobRow>(this.db, `
      UPDATE ingestion_jobs
      SET status = 'pending',
          available_at = timezone('utc', now()),
          locked_by = NULL,
          locked_at = NULL,
          last_error_code = NULL,
          last_error_message = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1 AND status = 'failed'
      RETURNING *
    `, [jobId]);
    return result.rows[0] ?? null;
  }

  async listExpiredPending(now: Date): Promise<MediaUploadRow[]> {
    const result = await query<MediaUploadRow>(this.db, `
      SELECT * FROM media_uploads
      WHERE status = 'upload_pending' AND presign_expires_at < $1
    `, [now.toISOString()]);
    return result.rows;
  }

  async listOrphans(prefix: string): Promise<MediaUploadRow[]> {
    const result = await query<MediaUploadRow>(this.db, `
      SELECT * FROM media_uploads
      WHERE object_key LIKE $1
        AND status IN ('upload_pending', 'cancelled', 'failed')
    `, [`${prefix}%`]);
    return result.rows;
  }
}

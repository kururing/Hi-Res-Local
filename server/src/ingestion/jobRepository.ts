import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';
import type { IngestionJobRow, MediaUploadRow } from '../admin/uploadRepository.js';

export interface ClaimedJob {
  job: IngestionJobRow;
  upload: MediaUploadRow;
}

export class IngestionJobRepository {
  constructor(private readonly db: Queryable) {}

  async reclaimExpiredLeases(leaseSeconds: number): Promise<number> {
    const seconds = Number.isFinite(leaseSeconds) ? Math.max(15, Math.trunc(leaseSeconds)) : 120;
    const result = await query(this.db, `
      UPDATE ingestion_jobs
      SET status = 'pending',
          locked_by = NULL,
          locked_at = NULL,
          updated_at = timezone('utc', now())
      WHERE status = 'probing'
        AND (
          locked_at IS NULL
          OR locked_at < timezone('utc', now()) - make_interval(secs => $1)
        )
    `, [seconds]);
    return result.rowCount ?? 0;
  }

  async claimNext(workerId: string): Promise<ClaimedJob | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claimed = await query<IngestionJobRow>(this.db, `
        UPDATE ingestion_jobs
        SET status = 'probing',
            attempts = attempts + 1,
            locked_by = $1,
            locked_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
        WHERE id = (
          SELECT id
          FROM ingestion_jobs
          WHERE status = 'pending'
            AND available_at <= timezone('utc', now())
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *
      `, [workerId]);
      const job = claimed.rows[0];
      if (!job) return null;
      const upload = await query<MediaUploadRow>(
        this.db,
        'SELECT * FROM media_uploads WHERE id = $1',
        [job.upload_id],
      );
      const row = upload.rows[0];
      if (row) return { job, upload: row };
      await this.markFailed(job.id, workerId, 'UPLOAD_NOT_FOUND', 'Upload was not found.', null);
    }
    return null;
  }

  async renewLease(jobId: string, workerId: string): Promise<boolean> {
    const result = await query(this.db, `
      UPDATE ingestion_jobs
      SET locked_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
      WHERE id = $1 AND status = 'probing' AND locked_by = $2
    `, [jobId, workerId]);
    return (result.rowCount ?? 0) === 1;
  }

  async lockOwnedJob(jobId: string, workerId: string): Promise<boolean> {
    const result = await query(this.db, `
      SELECT id
      FROM ingestion_jobs
      WHERE id = $1 AND status = 'probing' AND locked_by = $2
      FOR UPDATE
    `, [jobId, workerId]);
    return (result.rowCount ?? 0) === 1;
  }

  async markReady(jobId: string, workerId: string): Promise<boolean> {
    const result = await query(this.db, `
      UPDATE ingestion_jobs
      SET status = 'ready',
          last_error_code = NULL,
          last_error_message = NULL,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1 AND status = 'probing' AND locked_by = $2
    `, [jobId, workerId]);
    return (result.rowCount ?? 0) === 1;
  }

  async markFailed(
    jobId: string,
    workerId: string,
    code: string,
    message: string,
    retryAt: Date | null,
  ): Promise<boolean> {
    const result = await query(this.db, `
      UPDATE ingestion_jobs
      SET status = CASE WHEN $5::timestamptz IS NULL THEN 'failed' ELSE 'pending' END,
          available_at = COALESCE($5, available_at),
          last_error_code = $3,
          last_error_message = $4,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1 AND status = 'probing' AND locked_by = $2
    `, [jobId, workerId, code, message, retryAt?.toISOString() ?? null]);
    return (result.rowCount ?? 0) === 1;
  }
}

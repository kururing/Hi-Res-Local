import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';
import type { ImportDetectedMetadata, ImportOverrideMetadata } from './importMetadata.js';
import type { ImportMatchResult } from './matching.js';

export type AudioImportStatus =
  | 'waiting_upload'
  | 'uploading'
  | 'verifying'
  | 'probing'
  | 'needs_review'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'duplicate'
  | 'failed'
  | 'cancelled';

export interface AudioImportRow {
  id: string;
  owner_id: string;
  upload_id: string | null;
  original_filename: string;
  expected_mime: string;
  expected_size_bytes: string | number;
  expected_checksum_sha256: string;
  bucket: string;
  object_key: string;
  status: AudioImportStatus;
  detected_metadata_json: ImportDetectedMetadata | Record<string, unknown>;
  override_metadata_json: ImportOverrideMetadata | Record<string, unknown>;
  match_json: ImportMatchResult | Record<string, unknown>;
  committed_track_id: string | null;
  committed_album_id: string | null;
  committed_artist_id: string | null;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export class AudioImportRepository {
  constructor(private readonly db: Queryable) {}

  async insert(input: {
    id: string;
    ownerId: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    checksum: string;
    bucket: string;
    objectKey: string;
    status: AudioImportStatus;
    expiresAt: Date;
    idempotencyKey: string | null;
  }): Promise<AudioImportRow> {
    const result = await query<AudioImportRow>(this.db, `
      INSERT INTO audio_imports (
        id, owner_id, original_filename, expected_mime, expected_size_bytes,
        expected_checksum_sha256, bucket, object_key, status, expires_at, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      input.id, input.ownerId, input.filename, input.mime, input.sizeBytes,
      input.checksum, input.bucket, input.objectKey, input.status,
      input.expiresAt.toISOString(), input.idempotencyKey,
    ]);
    return result.rows[0]!;
  }

  async attachUpload(id: string, uploadId: string, objectKey?: string, bucket?: string): Promise<void> {
    await query(this.db, `
      UPDATE audio_imports
      SET upload_id = $2,
          object_key = COALESCE($3, object_key),
          bucket = COALESCE($4, bucket),
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [id, uploadId, objectKey ?? null, bucket ?? null]);
  }

  async get(id: string): Promise<AudioImportRow | null> {
    const result = await query<AudioImportRow>(this.db, 'SELECT * FROM audio_imports WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async getForUpdate(id: string): Promise<AudioImportRow | null> {
    const result = await query<AudioImportRow>(this.db, 'SELECT * FROM audio_imports WHERE id = $1 FOR UPDATE', [id]);
    return result.rows[0] ?? null;
  }

  async getByUploadId(uploadId: string): Promise<AudioImportRow | null> {
    const result = await query<AudioImportRow>(this.db, 'SELECT * FROM audio_imports WHERE upload_id = $1', [uploadId]);
    return result.rows[0] ?? null;
  }

  async findByIdempotency(ownerId: string, key: string): Promise<AudioImportRow | null> {
    const result = await query<AudioImportRow>(this.db, `
      SELECT * FROM audio_imports WHERE owner_id = $1 AND idempotency_key = $2
    `, [ownerId, key]);
    return result.rows[0] ?? null;
  }

  async findActiveByChecksum(ownerId: string, checksum: string): Promise<AudioImportRow | null> {
    const result = await query<AudioImportRow>(this.db, `
      SELECT * FROM audio_imports
      WHERE owner_id = $1 AND expected_checksum_sha256 = $2 AND status <> 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1
    `, [ownerId, checksum]);
    return result.rows[0] ?? null;
  }

  async list(ownerId: string, statuses?: string[], limit = 50): Promise<AudioImportRow[]> {
    const result = await query<AudioImportRow>(this.db, `
      SELECT * FROM audio_imports
      WHERE owner_id = $1
        AND ($2::text[] IS NULL OR status = ANY($2))
      ORDER BY created_at DESC
      LIMIT $3
    `, [ownerId, statuses && statuses.length ? statuses : null, limit]);
    return result.rows;
  }

  async setStatus(
    id: string,
    status: AudioImportStatus,
    error?: { code: string; message: string } | null,
  ): Promise<void> {
    await query(this.db, `
      UPDATE audio_imports
      SET status = $2,
          error_code = $3,
          error_message = $4,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [id, status, error?.code ?? null, error?.message ?? null]);
  }

  async saveProbeResult(input: {
    id: string;
    status: AudioImportStatus;
    detected: ImportDetectedMetadata;
    match: ImportMatchResult;
  }): Promise<void> {
    await query(this.db, `
      UPDATE audio_imports
      SET status = $2,
          detected_metadata_json = $3::jsonb,
          match_json = $4::jsonb,
          error_code = NULL,
          error_message = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [input.id, input.status, JSON.stringify(input.detected), JSON.stringify(input.match)]);
  }

  async saveOverride(id: string, override: ImportOverrideMetadata, match: ImportMatchResult, status: AudioImportStatus): Promise<void> {
    await query(this.db, `
      UPDATE audio_imports
      SET override_metadata_json = $2::jsonb,
          match_json = $3::jsonb,
          status = $4,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [id, JSON.stringify(override), JSON.stringify(match), status]);
  }

  async markCommitted(input: {
    id: string;
    trackId: string;
    albumId: string | null;
    artistId: string | null;
  }): Promise<void> {
    await this.markOutcome({ ...input, status: 'published' });
  }

  async markOutcome(input: {
    id: string;
    status: 'published' | 'duplicate';
    trackId: string;
    albumId: string | null;
    artistId: string | null;
  }): Promise<void> {
    await query(this.db, `
      UPDATE audio_imports
      SET status = $2,
          committed_track_id = $3,
          committed_album_id = $4,
          committed_artist_id = $5,
          error_code = NULL,
          error_message = NULL,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [input.id, input.status, input.trackId, input.albumId, input.artistId]);
  }

  async findByObjectKey(objectKey: string): Promise<AudioImportRow | null> {
    const result = await query<AudioImportRow>(this.db, `
      SELECT * FROM audio_imports WHERE object_key = $1 ORDER BY created_at DESC LIMIT 1
    `, [objectKey]);
    return result.rows[0] ?? null;
  }

  async listLinkedObjectKeys(): Promise<Set<string>> {
    const result = await query<{ key: string }>(this.db, `
      SELECT object_key AS key FROM media_uploads
      UNION
      SELECT storage_key AS key FROM audio_assets
      UNION
      SELECT object_key AS key FROM audio_imports
    `);
    return new Set(result.rows.map((row) => row.key));
  }
}

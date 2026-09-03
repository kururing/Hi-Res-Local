import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { isUniqueViolation } from '../db/pgErrors.js';
import { toIso, toNumber, withTransaction } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { sha256HexFromStream, tryNormalizeSha256 } from '../ingestion/checksum.js';
import { writeAdminAudit } from './audit.js';
import { AdminCatalogRepository } from './catalogRepository.js';
import { autoPublishImport } from './autoPublish.js';
import { fillCatalogRemoteArtwork } from './fillRemoteArtwork.js';
import {
  asDetected,
  importIsReady,
  mergeImportMetadata,
  sanitizeOverride,
  type EffectiveImportMetadata,
  type ImportDetectedMetadata,
  type ImportOverrideMetadata,
} from './importMetadata.js';
import { AudioImportRepository, type AudioImportRow, type AudioImportStatus } from './importRepository.js';
import { buildImportMatch, type ImportMatchResult } from './matching.js';
import { AUDIO_EXTENSIONS, buildObjectKey, mimeFromAudioFilename, normalizeExtension } from './mediaTypes.js';
import { AdminUploadService, type PresignResponse, type UploadInitInput } from './uploadService.js';
import { UploadRepository } from './uploadRepository.js';
import type { ObjectStorageSigner } from '../storage/signer.js';
import type { RemoteArtworkLookup } from '../ingestion/remoteArtwork.js';

const PROCESSING = ['waiting_upload', 'uploading', 'verifying', 'probing', 'publishing'];
const FAILED_GROUP = ['failed', 'cancelled'];

export interface ImportView {
  id: string;
  status: AudioImportStatus;
  original_filename: string;
  expected_mime: string;
  expected_size_bytes: number;
  checksum_sha256: string;
  upload_id: string | null;
  job_id: string | null;
  job_status: string | null;
  detected: ImportDetectedMetadata;
  override: ImportOverrideMetadata;
  effective: EffectiveImportMetadata;
  match: ImportMatchResult;
  review_fields: string[];
  committed_track_id: string | null;
  committed_album_id: string | null;
  committed_artist_id: string | null;
  error_code: string | null;
  error_message: string | null;
  publish_blockers: string[];
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface ImportCreateResponse {
  import: ImportView;
  upload: PresignResponse;
}

export class AdminImportService {
  constructor(
    private readonly pool: Pool,
    private readonly uploads: AdminUploadService,
    private readonly config: AppConfig,
    private readonly signer: ObjectStorageSigner,
    private readonly remoteArtwork?: RemoteArtworkLookup,
  ) {}

  async create(
    input: UploadInitInput,
    adminId: string,
    requestId: string,
    idempotencyKey: string | null,
  ): Promise<ImportCreateResponse> {
    const checksum = tryNormalizeSha256(input.checksum_sha256);
    if (!checksum) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'checksum_sha256 must be hex or base64 SHA-256.');
    }
    const repo = new AudioImportRepository(this.pool);
    if (idempotencyKey) {
      const existing = await repo.findByIdempotency(adminId, idempotencyKey);
      if (existing) {
        this.assertSameInit(existing, input, checksum);
        return this.presignFor(existing, adminId);
      }
    }
    const byChecksum = await repo.findActiveByChecksum(adminId, checksum);
    if (byChecksum) return this.presignFor(byChecksum, adminId);

    const importId = randomUUID();
    const objectKey = buildObjectKey('audio', importId, input.filename);
    const expiresAt = new Date(Date.now() + this.config.presignPutTtlSeconds * 1000);

    try {
      await withTransaction(this.pool, async (trx) => {
        const imports = new AudioImportRepository(trx);
        await imports.insert({
          id: importId,
          ownerId: adminId,
          filename: input.filename.trim().replace(/[/\\]/g, ''),
          mime: input.content_type.trim().toLowerCase(),
          sizeBytes: input.size_bytes,
          checksum,
          bucket: this.config.s3.bucket,
          objectKey,
          status: 'waiting_upload',
          expiresAt,
          idempotencyKey,
        });
        await writeAdminAudit(trx, {
          adminUserId: adminId,
          action: 'import.create',
          entityType: 'import',
          entityId: importId,
          requestId,
          metadata: { size_bytes: input.size_bytes, content_type: input.content_type },
        });
      });
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error)) {
        const existing = await repo.findByIdempotency(adminId, idempotencyKey);
        if (existing) return this.presignFor(existing, adminId);
      }
      if (isUniqueViolation(error)) {
        const existing = await repo.findActiveByChecksum(adminId, checksum);
        if (existing) return this.presignFor(existing, adminId);
      }
      throw error;
    }

    const created = await repo.get(importId);
    if (!created) throw new AppError(500, ErrorCodes.INTERNAL_ERROR, 'Failed to create import.');
    return this.presignFor(created, adminId, requestId, idempotencyKey);
  }

  async list(adminId: string, status?: string): Promise<ImportView[]> {
    const statuses = expandStatusFilter(status);
    const rows = await new AudioImportRepository(this.pool).list(adminId, statuses);
    return Promise.all(rows.map((row) => this.toView(row, adminId)));
  }

  async get(id: string, adminId: string): Promise<ImportView> {
    return this.toView(await this.requireOwned(id, adminId), adminId);
  }

  async complete(id: string, adminId: string, requestId: string): Promise<ImportView> {
    let row = await this.requireOwned(id, adminId);
    if (!row.upload_id) {
      row = await this.attachExistingUpload(row);
    }
    if (!row.upload_id) throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Import upload was not initialized.');
    if (row.status === 'cancelled' || row.status === 'published') {
      throw new AppError(409, ErrorCodes.IMPORT_CONFLICT, 'Import cannot be completed in its current state.');
    }
    await new AudioImportRepository(this.pool).setStatus(id, 'verifying');
    await this.uploads.complete(row.upload_id, adminId, requestId);
    await new AudioImportRepository(this.pool).setStatus(id, 'probing');
    await writeAdminAudit(this.pool, {
      adminUserId: adminId,
      action: 'import.complete',
      entityType: 'import',
      entityId: id,
      requestId,
      metadata: { upload_id: row.upload_id },
    });
    return this.get(id, adminId);
  }

  async cancel(id: string, adminId: string, requestId: string): Promise<ImportView> {
    const row = await this.requireOwned(id, adminId);
    if (row.status === 'published') {
      throw new AppError(409, ErrorCodes.IMPORT_CONFLICT, 'A published import cannot be cancelled.');
    }
    if (row.upload_id) {
      await this.uploads.cancel(row.upload_id, adminId, requestId);
    }
    await new AudioImportRepository(this.pool).setStatus(id, 'cancelled');
    await writeAdminAudit(this.pool, {
      adminUserId: adminId,
      action: 'import.cancel',
      entityType: 'import',
      entityId: id,
      requestId,
      metadata: {},
    });
    return this.get(id, adminId);
  }

  async retry(id: string, adminId: string, requestId: string): Promise<ImportView> {
    let row = await this.requireOwned(id, adminId);
    if (row.status === 'published' || row.status === 'duplicate') {
      throw new AppError(409, ErrorCodes.IMPORT_CONFLICT, 'A published import cannot be retried.');
    }
    if (!row.upload_id) {
      row = await this.attachExistingUpload(row);
    }
    if (!row.upload_id) throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Import upload was not initialized.');
    const job = await new UploadRepository(this.pool).getLatestJob(row.upload_id);
    const jobFailed = job?.status === 'failed';
    if (row.status !== 'failed' && row.status !== 'cancelled' && !jobFailed) {
      throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Only a failed import can be retried.');
    }
    if (jobFailed && job) await this.uploads.retryJob(job.id, adminId, requestId);
    else if (!job) await this.uploads.complete(row.upload_id, adminId, requestId);
    await new AudioImportRepository(this.pool).setStatus(id, 'probing');
    return this.get(id, adminId);
  }

  async patch(id: string, body: Record<string, unknown>, adminId: string, requestId: string): Promise<ImportView> {
    const row = await this.requireOwned(id, adminId);
    if (row.status === 'published' || row.status === 'cancelled') {
      throw new AppError(409, ErrorCodes.IMPORT_CONFLICT, 'This import can no longer be edited.');
    }
    const override = { ...asOverride(row.override_metadata_json), ...sanitizeOverride(body) };
    const detected = asDetected(row.detected_metadata_json);
    const effective = mergeImportMetadata(detected, override);
    const match = await buildImportMatch(this.pool, {
      artist: effective.artist,
      albumArtist: effective.album_artist,
      album: effective.album,
      selectedArtistId: effective.selected_artist_id,
    });
    const nextStatus = row.status === 'waiting_upload' || row.status === 'verifying' || row.status === 'probing' || row.status === 'uploading'
      ? row.status
      : importIsReady(effective) ? 'ready' : 'needs_review';
    await new AudioImportRepository(this.pool).saveOverride(id, override, match, nextStatus);
    await writeAdminAudit(this.pool, {
      adminUserId: adminId,
      action: 'import.update',
      entityType: 'import',
      entityId: id,
      requestId,
      metadata: { fields: Object.keys(body) },
    });
    return this.get(id, adminId);
  }

  async commit(id: string, _body: Record<string, unknown>, adminId: string, requestId: string): Promise<ImportView> {
    const published = await withTransaction(this.pool, async (trx) => {
      const imports = new AudioImportRepository(trx);
      const row = await imports.get(id);
      if (!row) throw new AppError(404, ErrorCodes.IMPORT_NOT_FOUND, 'Import not found.');
      if (row.owner_id !== adminId) throw new AppError(403, ErrorCodes.IMPORT_FORBIDDEN, 'This import belongs to another admin.');
      if ((row.status === 'published' || row.status === 'duplicate') && row.committed_track_id) {
        return { view: this.toView(row, adminId, trx), artistId: row.committed_artist_id, albumId: row.committed_album_id, fill: false };
      }
      const detected = asDetected(row.detected_metadata_json);
      if (!detected.title && !detected.duration_seconds) {
        throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Import has not been probed yet.');
      }
      const result = await autoPublishImport(trx, {
        row,
        detected,
        adminId,
        requestId,
        checksum: row.expected_checksum_sha256,
      });
      const next = await imports.get(id);
      return {
        view: this.toView(next!, adminId, trx),
        artistId: result.artistId,
        albumId: result.albumId,
        fill: result.status === 'published',
      };
    });
    if (published.fill) {
      await fillCatalogRemoteArtwork(this.pool, this.remoteArtwork, published.artistId, published.albumId);
    }
    return published.view;
  }

  async commitMany(ids: string[], body: Record<string, unknown>, adminId: string, requestId: string): Promise<ImportView[]> {
    const results: ImportView[] = [];
    for (const id of ids) {
      results.push(await this.commit(id, body, adminId, requestId));
    }
    return results;
  }

  async reconcile(adminId: string, requestId: string): Promise<{ scanned: number; enqueued: number; skipped: number; imports: ImportView[] }> {
    const list = this.signer.listObjects;
    if (!list) {
      throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Object listing is not available on this storage backend.');
    }
    const prefixes = requireReconcilePrefixes(this.config.importReconcilePrefixes);
    const repo = new AudioImportRepository(this.pool);
    const linked = await repo.listLinkedObjectKeys();
    const catalog = new AdminCatalogRepository(this.pool);
    const created: ImportView[] = [];
    let scanned = 0;
    let skipped = 0;

    for (const prefix of prefixes) {
      if (scanned >= this.config.importReconcileMaxObjects) break;
      for await (const object of list.call(this.signer, prefix, this.config.s3.bucket)) {
        if (scanned >= this.config.importReconcileMaxObjects) break;
        scanned += 1;
        if (!object.key || object.key.startsWith('ingestion/artwork/')) {
          skipped += 1;
          continue;
        }
        if (linked.has(object.key)) {
          skipped += 1;
          continue;
        }
        if (!normalizeExtension(object.key, AUDIO_EXTENSIONS)) {
          skipped += 1;
          continue;
        }
        if (object.size != null && object.size > this.config.uploadMaxAudioBytes) {
          skipped += 1;
          continue;
        }
        const hashed = await hashStoredObject(this.signer, object.key, this.config.s3.bucket, this.config.uploadMaxAudioBytes);
        if (!hashed) {
          skipped += 1;
          continue;
        }
        const existingAsset = await catalog.findAvailableAssetByChecksum(hashed.checksum);
        if (existingAsset) {
          skipped += 1;
          continue;
        }
        const existingImport = await repo.findByObjectKey(object.key);
        if (existingImport && existingImport.status !== 'cancelled') {
          skipped += 1;
          continue;
        }
        const importId = randomUUID();
        const filename = object.key.split('/').filter(Boolean).at(-1) ?? `${importId}.audio`;
        const expiresAt = new Date(Date.now() + this.config.presignPutTtlSeconds * 1000);
        try {
          await repo.insert({
            id: importId,
            ownerId: adminId,
            filename,
            mime: mimeFromAudioFilename(filename),
            sizeBytes: hashed.size,
            checksum: hashed.checksum,
            bucket: this.config.s3.bucket,
            objectKey: object.key,
            status: 'probing',
            expiresAt,
            idempotencyKey: `reconcile:${hashed.checksum}`,
          });
          const uploadId = await this.uploads.adoptExistingAudio({
            importId,
            objectKey: object.key,
            filename,
            mime: mimeFromAudioFilename(filename),
            sizeBytes: hashed.size,
            checksum: hashed.checksum,
            adminId,
            requestId,
          });
          await repo.attachUpload(importId, uploadId, object.key, this.config.s3.bucket);
          linked.add(object.key);
          created.push(await this.get(importId, adminId));
        } catch (error) {
          if (isUniqueViolation(error)) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }
    }

    await writeAdminAudit(this.pool, {
      adminUserId: adminId,
      action: 'import.reconcile',
      entityType: 'import',
      entityId: adminId,
      requestId,
      metadata: { scanned, enqueued: created.length, skipped },
    });
    return { scanned, enqueued: created.length, skipped, imports: created };
  }

  private async requireOwned(id: string, adminId: string): Promise<AudioImportRow> {
    const row = await new AudioImportRepository(this.pool).get(id);
    if (!row) throw new AppError(404, ErrorCodes.IMPORT_NOT_FOUND, 'Import not found.');
    if (row.owner_id !== adminId) throw new AppError(403, ErrorCodes.IMPORT_FORBIDDEN, 'This import belongs to another admin.');
    return row;
  }

  private assertSameInit(existing: AudioImportRow, input: UploadInitInput, checksum: string): void {
    if (
      existing.expected_checksum_sha256 !== checksum
      || toNumber(existing.expected_size_bytes) !== input.size_bytes
    ) {
      throw new AppError(409, ErrorCodes.UPLOAD_CONFLICT, 'Idempotency key was reused with different upload parameters.');
    }
  }

  private async attachExistingUpload(row: AudioImportRow): Promise<AudioImportRow> {
    const existing = await new UploadRepository(this.pool).findLatestByEntity('import', row.id);
    if (!existing || existing.status === 'cancelled') return row;
    await new AudioImportRepository(this.pool).attachUpload(
      row.id,
      existing.id,
      existing.object_key,
      existing.bucket,
    );
    return (await new AudioImportRepository(this.pool).get(row.id)) ?? row;
  }

  private async presignFor(
    row: AudioImportRow,
    adminId: string,
    requestId = 'import-resume',
    idempotencyKey: string | null = null,
  ): Promise<ImportCreateResponse> {
    const uploads = new UploadRepository(this.pool);
    const imports = new AudioImportRepository(this.pool);
    let uploadRow = row.upload_id ? await uploads.getUpload(row.upload_id) : null;
    if (!uploadRow || uploadRow.status === 'cancelled') {
      uploadRow = await uploads.findLatestByEntity('import', row.id);
    }
    if (uploadRow && uploadRow.status !== 'cancelled') {
      await imports.attachUpload(row.id, uploadRow.id, uploadRow.object_key, uploadRow.bucket);
      const refreshed = await imports.get(row.id);
      const presign = await this.uploads.presignExisting(uploadRow.id);
      return { import: await this.toView(refreshed!, adminId), upload: { ...presign, object_key: null } };
    }
    const presign = await this.uploads.initForImport(row.id, {
      filename: row.original_filename,
      content_type: row.expected_mime,
      size_bytes: toNumber(row.expected_size_bytes),
      checksum_sha256: row.expected_checksum_sha256,
    }, adminId, requestId, idempotencyKey);
    const created = await uploads.getUpload(presign.upload_id);
    if (!created) throw new AppError(500, ErrorCodes.INTERNAL_ERROR, 'Failed to create upload.');
    await imports.attachUpload(row.id, created.id, created.object_key, created.bucket);
    const refreshed = await imports.get(row.id);
    return { import: await this.toView(refreshed!, adminId), upload: { ...presign, object_key: null } };
  }

  private async toView(row: AudioImportRow, adminId: string, db: import('../db/types.js').Queryable = this.pool): Promise<ImportView> {
    void adminId;
    const detected = asDetected(row.detected_metadata_json);
    const override = asOverride(row.override_metadata_json);
    const effective = mergeImportMetadata(detected, override);
    const match = asMatch(row.match_json);
    const job = row.upload_id ? await new UploadRepository(db).getLatestJob(row.upload_id) : null;
    const terminal = row.status === 'published' || row.status === 'duplicate';
    const jobFailed = job?.status === 'failed';
    const status = !terminal && row.status !== 'cancelled' && jobFailed ? 'failed' : row.status;
    const errorCode = terminal
      ? null
      : (row.error_code ?? (jobFailed ? job?.last_error_code ?? null : null));
    return {
      id: row.id,
      status,
      original_filename: row.original_filename,
      expected_mime: row.expected_mime,
      expected_size_bytes: toNumber(row.expected_size_bytes),
      checksum_sha256: row.expected_checksum_sha256,
      upload_id: row.upload_id,
      job_id: job?.id ?? null,
      job_status: job?.status ?? null,
      detected,
      override,
      effective,
      match,
      review_fields: effective.review_fields,
      committed_track_id: row.committed_track_id,
      committed_album_id: row.committed_album_id,
      committed_artist_id: row.committed_artist_id,
      error_code: errorCode,
      error_message: publicError(errorCode, row.error_message),
      publish_blockers: publishBlockersForImport(effective, match, status),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      expires_at: toIso(row.expires_at),
    };
  }
}

function expandStatusFilter(status?: string): string[] | undefined {
  if (!status?.trim()) return undefined;
  if (status === 'processing') return PROCESSING;
  if (status === 'failed') return FAILED_GROUP;
  return status.split(',').map((item) => item.trim()).filter(Boolean);
}

function asOverride(value: unknown): ImportOverrideMetadata {
  return (value && typeof value === 'object' ? value : {}) as ImportOverrideMetadata;
}

function asMatch(value: unknown): ImportMatchResult {
  const empty = { status: 'none' as const, candidates: [] };
  if (!value || typeof value !== 'object') return { artist: empty, album: empty };
  const record = value as ImportMatchResult;
  return {
    artist: record.artist ?? empty,
    album: record.album ?? empty,
  };
}

function publicError(code: string | null, message: string | null): string | null {
  if (!code && !message) return null;
  if (message && /[\\/]|\.sql\b|postgres|minio|127\.0\.0\.1|amazonaws/i.test(message)) {
    return 'Processing failed.';
  }
  if (code === 'PROBE_UNSUPPORTED') return 'This audio format is not supported.';
  if (code === 'INGESTION_FAILED') return message && message !== 'Ingestion failed.' ? message : 'Audio processing failed.';
  return message ?? code;
}

function publishBlockersForImport(
  _effective: EffectiveImportMetadata,
  _match: ImportMatchResult,
  _status: AudioImportStatus,
): string[] {
  return [];
}

async function hashStoredObject(
  signer: ObjectStorageSigner,
  objectKey: string,
  bucket: string,
  maxBytes: number,
): Promise<{ checksum: string; size: number } | null> {
  if (!signer.getObjectStream) return null;
  try {
    const stream = await signer.getObjectStream(objectKey, bucket);
    return sha256HexFromStream(stream, maxBytes);
  } catch {
    return null;
  }
}

export function requireReconcilePrefixes(prefixes: string[]): string[] {
  const cleaned = prefixes.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new AppError(
      409,
      ErrorCodes.IMPORT_NOT_READY,
      'IMPORT_RECONCILE_PREFIXES must list one or more object-key prefixes.',
    );
  }
  return cleaned;
}

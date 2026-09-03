import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { isUniqueViolation } from '../db/pgErrors.js';
import { toIso, toNumber, withTransaction } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { normalizeSha256, sha256HexFromStream, tryNormalizeSha256 } from '../ingestion/checksum.js';
import { requireObjectStore } from '../storage/signer.js';
import type { ObjectStorageSigner } from '../storage/signer.js';
import { writeAdminAudit } from './audit.js';
import { AdminCatalogRepository } from './catalogRepository.js';
import { AudioImportRepository } from './importRepository.js';
import { buildObjectKey } from './mediaTypes.js';
import { UploadRepository, type MediaUploadRow } from './uploadRepository.js';

export interface UploadInitInput {
  filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
}

export interface PresignResponse {
  upload_id: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expires_at: string;
  object_key: null;
}

export interface UploadStatusView {
  upload_id: string;
  media_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  expected_filename: string;
  expected_mime: string;
  expected_size_bytes: number;
  checksum_status: 'pending' | 'matched' | 'mismatch' | 'unavailable';
  job_id: string | null;
  job_status: string | null;
  job_error: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function safeFilename(value: string): string {
  const name = value.trim().replace(/[/\\]/g, '');
  if (!name || name.length > 255 || name.includes('..')) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'filename is invalid.');
  }
  return name;
}

export class AdminUploadService {
  constructor(
    private readonly pool: Pool,
    private readonly signer: ObjectStorageSigner,
    private readonly config: AppConfig,
  ) {}

  async initAudio(
    trackId: string,
    input: UploadInitInput,
    adminId: string,
    requestId: string,
    idempotencyKey: string | null,
  ): Promise<PresignResponse> {
    const catalog = new AdminCatalogRepository(this.pool);
    const track = await catalog.getTrack(trackId);
    if (!track || track.deleted_at) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
    }
    return this.initUpload({
      mediaType: 'audio',
      entityType: 'track',
      entityId: trackId,
      input,
      adminId,
      requestId,
      idempotencyKey,
      allowedMimes: this.config.allowedAudioMimes,
      maxBytes: this.config.uploadMaxAudioBytes,
      bucket: this.config.s3.bucket,
    });
  }

  async initForImport(
    importId: string,
    input: UploadInitInput,
    adminId: string,
    requestId: string,
    idempotencyKey: string | null,
  ): Promise<PresignResponse> {
    return this.initUpload({
      mediaType: 'audio',
      entityType: 'import',
      entityId: importId,
      input,
      adminId,
      requestId,
      idempotencyKey,
      allowedMimes: this.config.allowedAudioMimes,
      maxBytes: this.config.uploadMaxAudioBytes,
      bucket: this.config.s3.bucket,
    });
  }

  async adoptExistingAudio(input: {
    importId: string;
    objectKey: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    checksum: string;
    adminId: string;
    requestId: string;
  }): Promise<string> {
    const existing = await new UploadRepository(this.pool).getByObjectKey(input.objectKey);
    if (existing) return existing.id;
    const uploadId = randomUUID();
    await withTransaction(this.pool, async (trx) => {
      const uploads = new UploadRepository(trx);
      await uploads.insertUpload({
        id: uploadId,
        ownerId: input.adminId,
        mediaType: 'audio',
        entityType: 'import',
        entityId: input.importId,
        objectKey: input.objectKey,
        bucket: this.config.s3.bucket,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
        status: 'uploaded',
        presignExpiresAt: new Date(Date.now() + this.config.presignPutTtlSeconds * 1000),
        idempotencyKey: null,
      });
      await uploads.markUploaded(uploadId, input.sizeBytes, input.checksum);
      await uploads.insertJob({
        id: randomUUID(),
        uploadId,
        jobType: 'audio_probe',
        requestId: input.requestId,
      });
      await writeAdminAudit(trx, {
        adminUserId: input.adminId,
        action: 'import.reconcile',
        entityType: 'import',
        entityId: input.importId,
        requestId: input.requestId,
        metadata: { object_present: true },
      });
    });
    return uploadId;
  }

  async presignExisting(uploadId: string): Promise<PresignResponse> {
    const upload = await new UploadRepository(this.pool).getUpload(uploadId);
    if (!upload) throw new AppError(404, ErrorCodes.UPLOAD_NOT_FOUND, 'Upload not found.');
    return this.presign(upload);
  }

  async initArtwork(
    entityType: 'album' | 'artist',
    entityId: string,
    input: UploadInitInput,
    adminId: string,
    requestId: string,
    idempotencyKey: string | null,
  ): Promise<PresignResponse> {
    const catalog = new AdminCatalogRepository(this.pool);
    if (entityType === 'album' && !(await catalog.getAlbum(entityId))) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Album not found.');
    }
    if (entityType === 'artist' && !(await catalog.getArtist(entityId))) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Artist not found.');
    }
    return this.initUpload({
      mediaType: 'artwork',
      entityType,
      entityId,
      input,
      adminId,
      requestId,
      idempotencyKey,
      allowedMimes: this.config.allowedArtworkMimes,
      maxBytes: this.config.uploadMaxArtworkBytes,
      bucket: this.config.s3.artworkBucket,
    });
  }

  async getUpload(uploadId: string, adminId: string): Promise<UploadStatusView> {
    const uploads = new UploadRepository(this.pool);
    const upload = await uploads.getUpload(uploadId);
    if (!upload) throw new AppError(404, ErrorCodes.UPLOAD_NOT_FOUND, 'Upload not found.');
    if (upload.owner_id !== adminId) {
      throw new AppError(403, ErrorCodes.UPLOAD_FORBIDDEN, 'This upload belongs to another admin.');
    }
    const job = await uploads.getLatestJob(upload.id);
    return toStatusView(upload, job?.id ?? null, job?.status ?? null, job?.last_error_code ?? null);
  }

  async complete(uploadId: string, adminId: string, requestId: string): Promise<UploadStatusView> {
    const store = requireObjectStore(this.signer);
    return withTransaction(this.pool, async (trx) => {
      const uploads = new UploadRepository(trx);
      const upload = await uploads.getUpload(uploadId);
      if (!upload) throw new AppError(404, ErrorCodes.UPLOAD_NOT_FOUND, 'Upload not found.');
      if (upload.owner_id !== adminId) {
        throw new AppError(403, ErrorCodes.UPLOAD_FORBIDDEN, 'This upload belongs to another admin.');
      }
      if (upload.status === 'uploaded') {
        const existing = await uploads.getLatestJob(upload.id);
        return toStatusView(upload, existing?.id ?? null, existing?.status ?? null, existing?.last_error_code ?? null);
      }
      if (upload.status === 'cancelled') {
        throw new AppError(409, ErrorCodes.UPLOAD_CONFLICT, 'Upload was cancelled.');
      }
      if (new Date(upload.presign_expires_at).getTime() < Date.now() && upload.status === 'upload_pending') {
        await uploads.markFailed(upload.id, ErrorCodes.UPLOAD_EXPIRED, 'Presigned upload expired.');
        throw new AppError(409, ErrorCodes.UPLOAD_EXPIRED, 'Presigned upload expired.');
      }

      const head = await store.headObject(upload.object_key, upload.bucket).catch((error) => {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) {
          return { exists: false, contentLength: null, checksumSha256: null, etag: null, contentType: null };
        }
        throw new AppError(503, ErrorCodes.NOT_READY, 'Could not verify the uploaded object. Try again.');
      });
      if (!head.exists) {
        await uploads.markFailed(upload.id, ErrorCodes.UPLOAD_OBJECT_MISSING, 'Uploaded object was not found.');
        throw new AppError(409, ErrorCodes.UPLOAD_OBJECT_MISSING, 'Uploaded object was not found.');
      }
      const actualSize = head.contentLength;
      if (actualSize == null || actualSize !== toNumber(upload.expected_size_bytes)) {
        await uploads.markFailed(upload.id, ErrorCodes.UPLOAD_SIZE_MISMATCH, 'Uploaded object size does not match.');
        throw new AppError(409, ErrorCodes.UPLOAD_SIZE_MISMATCH, 'Uploaded object size does not match.');
      }
      let checksum = head.checksumSha256;
      if (!checksum) {
        const hashed = await hashStoredObject(store, upload.object_key, upload.bucket, this.config.uploadMaxAudioBytes);
        if (!hashed || hashed.size !== actualSize) {
          await uploads.markFailed(upload.id, ErrorCodes.UPLOAD_CHECKSUM_MISMATCH, 'Uploaded object checksum could not be verified.');
          throw new AppError(409, ErrorCodes.UPLOAD_CHECKSUM_MISMATCH, 'Uploaded object checksum could not be verified.');
        }
        checksum = hashed.checksum;
      }
      if (checksum !== upload.expected_checksum_sha256) {
        await uploads.markFailed(upload.id, ErrorCodes.UPLOAD_CHECKSUM_MISMATCH, 'Uploaded object checksum does not match.');
        throw new AppError(409, ErrorCodes.UPLOAD_CHECKSUM_MISMATCH, 'Uploaded object checksum does not match.');
      }

      await uploads.markUploaded(upload.id, actualSize, checksum);
      const job = await uploads.insertJob({
        id: randomUUID(),
        uploadId: upload.id,
        jobType: upload.media_type === 'audio' ? 'audio_probe' : 'artwork_process',
        requestId,
      });
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'upload.complete',
        entityType: upload.entity_type,
        entityId: upload.entity_id,
        requestId,
        metadata: { upload_id: upload.id, size_bytes: actualSize, checksum_verified: true },
      });
      const refreshed = await uploads.getUpload(upload.id);
      return toStatusView(refreshed!, job.id, job.status, null);
    });
  }

  async cancel(uploadId: string, adminId: string, requestId: string): Promise<UploadStatusView> {
    const store = requireObjectStore(this.signer);
    const cancelled = await withTransaction(this.pool, async (trx) => {
      const uploads = new UploadRepository(trx);
      const upload = await uploads.getUpload(uploadId);
      if (!upload) throw new AppError(404, ErrorCodes.UPLOAD_NOT_FOUND, 'Upload not found.');
      if (upload.owner_id !== adminId) {
        throw new AppError(403, ErrorCodes.UPLOAD_FORBIDDEN, 'This upload belongs to another admin.');
      }
      await uploads.cancelJobs(upload.id);
      const lockedUpload = await uploads.getUploadForUpdate(upload.id);
      if (!lockedUpload) throw new AppError(404, ErrorCodes.UPLOAD_NOT_FOUND, 'Upload not found.');
      if (lockedUpload.entity_type === 'import') {
        const imports = new AudioImportRepository(trx);
        const linkedImport = await imports.getForUpdate(lockedUpload.entity_id);
        if (linkedImport?.status === 'published' || linkedImport?.status === 'duplicate') {
          throw new AppError(409, ErrorCodes.IMPORT_CONFLICT, 'A published import cannot be cancelled.');
        }
        if (linkedImport) await imports.setStatus(linkedImport.id, 'cancelled');
      }
      await uploads.markCancelled(lockedUpload.id);
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'upload.cancel',
        entityType: lockedUpload.entity_type,
        entityId: lockedUpload.entity_id,
        requestId,
        metadata: { upload_id: lockedUpload.id },
      });
      const refreshed = await uploads.getUpload(lockedUpload.id);
      return {
        view: toStatusView(refreshed!, null, 'cancelled', null),
        objectKey: lockedUpload.object_key,
        bucket: lockedUpload.bucket,
      };
    });
    try {
      await store.deleteObject(cancelled.objectKey, cancelled.bucket);
    } catch {
      // Best-effort orphan cleanup; cleanup command retries later.
    }
    return cancelled.view;
  }

  async retryJob(jobId: string, adminId: string, requestId: string): Promise<UploadStatusView> {
    return withTransaction(this.pool, async (trx) => {
      const uploads = new UploadRepository(trx);
      const reset = await uploads.resetJobForRetry(jobId);
      if (!reset) {
        throw new AppError(409, ErrorCodes.INGESTION_NOT_READY, 'Only a failed job can be retried.');
      }
      const upload = await uploads.getUpload(reset.upload_id);
      if (!upload) throw new AppError(404, ErrorCodes.UPLOAD_NOT_FOUND, 'Upload not found.');
      if (upload.owner_id !== adminId) {
        throw new AppError(403, ErrorCodes.UPLOAD_FORBIDDEN, 'This upload belongs to another admin.');
      }
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'ingestion.retry',
        entityType: upload.entity_type,
        entityId: upload.entity_id,
        requestId,
        metadata: { job_id: jobId, upload_id: upload.id },
      });
      return toStatusView(upload, reset.id, reset.status, null);
    });
  }

  private async initUpload(input: {
    mediaType: 'audio' | 'artwork';
    entityType: string;
    entityId: string;
    input: UploadInitInput;
    adminId: string;
    requestId: string;
    idempotencyKey: string | null;
    allowedMimes: string[];
    maxBytes: number;
    bucket: string;
  }): Promise<PresignResponse> {
    const filename = safeFilename(input.input.filename);
    const contentType = input.input.content_type.trim().toLowerCase();
    if (!input.allowedMimes.includes(contentType)) {
      throw new AppError(400, ErrorCodes.UPLOAD_INVALID_TYPE, 'File type is not allowed.');
    }
    if (!Number.isInteger(input.input.size_bytes) || input.input.size_bytes <= 0) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'size_bytes must be a positive integer.');
    }
    if (input.input.size_bytes > input.maxBytes) {
      throw new AppError(400, ErrorCodes.UPLOAD_TOO_LARGE, 'File exceeds the upload size limit.');
    }
    const checksum = tryNormalizeSha256(input.input.checksum_sha256);
    if (!checksum) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'checksum_sha256 must be hex or base64 SHA-256.');
    }

    const store = requireObjectStore(this.signer);
    const uploads = new UploadRepository(this.pool);
    if (input.idempotencyKey) {
      const existing = await uploads.findByIdempotency(input.adminId, input.idempotencyKey);
      if (existing) {
        if (
          existing.entity_id !== input.entityId
          || existing.expected_checksum_sha256 !== checksum
          || toNumber(existing.expected_size_bytes) !== input.input.size_bytes
        ) {
          throw new AppError(409, ErrorCodes.UPLOAD_CONFLICT, 'Idempotency key was reused with different upload parameters.');
        }
        return this.presign(existing);
      }
    }

    const uploadId = randomUUID();
    const objectKey = buildObjectKey(input.mediaType, uploadId, filename);
    const expiresAt = new Date(Date.now() + this.config.presignPutTtlSeconds * 1000);

    try {
      await withTransaction(this.pool, async (trx) => {
        const repo = new UploadRepository(trx);
        await repo.insertUpload({
          id: uploadId,
          ownerId: input.adminId,
          mediaType: input.mediaType,
          entityType: input.entityType,
          entityId: input.entityId,
          objectKey,
          bucket: input.bucket,
          filename,
          mime: contentType,
          sizeBytes: input.input.size_bytes,
          checksum,
          status: 'upload_pending',
          presignExpiresAt: expiresAt,
          idempotencyKey: input.idempotencyKey,
        });
        await writeAdminAudit(trx, {
          adminUserId: input.adminId,
          action: 'upload.init',
          entityType: input.entityType,
          entityId: input.entityId,
          requestId: input.requestId,
          metadata: {
            upload_id: uploadId,
            media_type: input.mediaType,
            size_bytes: input.input.size_bytes,
            content_type: contentType,
          },
        });
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const existing = await uploads.findByIdempotency(input.adminId, input.idempotencyKey);
        if (existing) return this.presign(existing);
      }
      throw error;
    }

    const created = await uploads.getUpload(uploadId);
    if (!created) throw new AppError(500, ErrorCodes.INTERNAL_ERROR, 'Failed to create upload.');
    void store;
    return this.presign(created);
  }

  private async presign(upload: MediaUploadRow): Promise<PresignResponse> {
    const store = requireObjectStore(this.signer);
    const signed = await store.createPutUrl(
      upload.object_key,
      this.config.presignPutTtlSeconds,
      {
        contentType: upload.expected_mime,
        contentLength: toNumber(upload.expected_size_bytes),
        checksumSha256: upload.expected_checksum_sha256,
      },
      upload.bucket,
    );
    return {
      upload_id: upload.id,
      method: 'PUT',
      url: signed.url,
      headers: signed.headers,
      expires_at: signed.expiresAt.toISOString(),
      object_key: null,
    };
  }
}

function toStatusView(
  upload: MediaUploadRow,
  jobId: string | null,
  jobStatus: string | null,
  jobError: string | null,
): UploadStatusView {
  let checksumStatus: UploadStatusView['checksum_status'] = 'pending';
  if (upload.actual_checksum_sha256 && upload.actual_checksum_sha256 === upload.expected_checksum_sha256) {
    checksumStatus = 'matched';
  } else if (upload.actual_checksum_sha256) {
    checksumStatus = 'mismatch';
  } else if (upload.status === 'uploaded') {
    checksumStatus = 'unavailable';
  }
  return {
    upload_id: upload.id,
    media_type: upload.media_type,
    entity_type: upload.entity_type,
    entity_id: upload.entity_id,
    status: upload.status,
    expected_filename: upload.expected_filename,
    expected_mime: upload.expected_mime,
    expected_size_bytes: toNumber(upload.expected_size_bytes),
    checksum_status: checksumStatus,
    job_id: jobId,
    job_status: jobStatus,
    job_error: jobError,
    error_code: upload.error_code,
    error_message: upload.error_message,
    created_at: toIso(upload.created_at),
    completed_at: upload.completed_at ? toIso(upload.completed_at) : null,
  };
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

export function parseChecksumOrThrow(value: string): string {
  return normalizeSha256(value);
}

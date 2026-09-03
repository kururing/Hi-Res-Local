import { rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { writeAdminAudit } from '../admin/audit.js';
import { isIngestionKey } from '../admin/mediaTypes.js';
import { UploadRepository } from '../admin/uploadRepository.js';
import { requireObjectStore, type ObjectStorageSigner } from '../storage/signer.js';

export interface CleanupResult {
  dryRun: boolean;
  expiredUploads: number;
  cancelledUploads: number;
  objectsDeleted: number;
  tempFilesRemoved: number;
}

export async function cleanupUploads(options: {
  pool: Pool;
  config: AppConfig;
  signer: ObjectStorageSigner;
  dryRun: boolean;
  deleteObjects: boolean;
}): Promise<CleanupResult> {
  const uploads = new UploadRepository(options.pool);
  const expired = await uploads.listExpiredPending(new Date());
  const orphans = await uploads.listOrphans('ingestion/');
  const candidates = new Map(expired.concat(orphans).map((row) => [row.id, row]));

  let objectsDeleted = 0;
  let expiredUploads = 0;
  let cancelledUploads = 0;
  const store = requireObjectStore(options.signer);

  for (const upload of candidates.values()) {
    if (!isIngestionKey(upload.object_key)) continue;
    if (upload.status === 'upload_pending') expiredUploads += 1;
    if (upload.status === 'cancelled' || upload.status === 'failed') cancelledUploads += 1;

    if (!options.dryRun && options.deleteObjects) {
      try {
        await store.deleteObject(upload.object_key, upload.bucket);
        objectsDeleted += 1;
      } catch {
        // Object may already be gone.
      }
      if (upload.status === 'upload_pending') {
        await uploads.markFailed(upload.id, 'UPLOAD_EXPIRED', 'Presigned upload expired.');
      }
    }
  }

  let tempFilesRemoved = 0;
  const tempDir = options.config.workerTempDir || path.join(tmpdir(), 'nghenhac-ingest');
  const staleMs = Math.max(options.config.workerLeaseSeconds, 60) * 2 * 1000;
  const jobTempName = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  try {
    const files = await readdir(tempDir);
    const now = Date.now();
    for (const file of files) {
      if (!jobTempName.test(file)) continue;
      const full = path.join(tempDir, file);
      try {
        const info = await stat(full);
        if (now - info.mtimeMs < staleMs) continue;
      } catch {
        continue;
      }
      if (!options.dryRun && options.deleteObjects) {
        await rm(full, { force: true });
      }
      tempFilesRemoved += 1;
    }
  } catch {
    // Temp directory may not exist.
  }

  if (!options.dryRun) {
    await writeAdminAudit(options.pool, {
      adminUserId: null,
      action: 'cleanup.uploads',
      entityType: 'media_upload',
      metadata: {
        expired_uploads: expiredUploads,
        cancelled_uploads: cancelledUploads,
        objects_deleted: objectsDeleted,
        temp_files_removed: tempFilesRemoved,
        delete_objects: options.deleteObjects,
      },
    });
  }

  return {
    dryRun: options.dryRun,
    expiredUploads,
    cancelledUploads,
    objectsDeleted: options.dryRun ? 0 : objectsDeleted,
    tempFilesRemoved: options.dryRun ? tempFilesRemoved : tempFilesRemoved,
  };
}

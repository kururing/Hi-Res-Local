import { randomUUID } from 'node:crypto';
import { parseFlagArgs } from '../src/cli/args.js';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { AdminImportService } from '../src/admin/importService.js';
import { AdminUploadService } from '../src/admin/uploadService.js';
import { S3ObjectStorageSigner } from '../src/storage/s3Signer.js';

const args = parseFlagArgs(process.argv.slice(2));
const adminId = typeof args.admin === 'string' ? args.admin : process.env.RECONCILE_ADMIN_USER_ID;
if (!adminId) {
  console.error('Pass --admin <user-uuid> or set RECONCILE_ADMIN_USER_ID.');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const signer = new S3ObjectStorageSigner(config.s3);
const uploads = new AdminUploadService(pool, signer, config);
const imports = new AdminImportService(pool, uploads, config, signer);

try {
  const result = await imports.reconcile(adminId, `cli-reconcile-${randomUUID()}`);
  console.log(JSON.stringify({
    scanned: result.scanned,
    enqueued: result.enqueued,
    skipped: result.skipped,
    import_ids: result.imports.map((row) => row.id),
  }, null, 2));
} finally {
  await pool.end();
}

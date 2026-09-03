import { loadConfig } from '../src/config/env.js';
import { parseFlagArgs } from '../src/cli/args.js';
import { createPool } from '../src/db/pool.js';
import { cleanupUploads } from '../src/ingestion/cleanup.js';
import { S3ObjectStorageSigner } from '../src/storage/s3Signer.js';

const args = parseFlagArgs(process.argv.slice(2));
const deleteObjects = args.delete === true || args['delete-objects'] === true;
const dryRun = args['dry-run'] === true || !deleteObjects;

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const signer = new S3ObjectStorageSigner(config.s3);

try {
  const result = await cleanupUploads({
    pool,
    config,
    signer,
    dryRun,
    deleteObjects: deleteObjects && !dryRun ? true : deleteObjects && !args['dry-run'],
  });
  console.log(JSON.stringify(result));
  if (result.dryRun) {
    console.log('Dry-run only. Pass --delete to remove orphan ingestion objects.');
  }
} finally {
  await pool.end();
}

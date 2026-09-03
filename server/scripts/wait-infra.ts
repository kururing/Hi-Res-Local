import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { createS3Client } from '../src/storage/bootstrap.js';
import { HeadBucketCommand } from '@aws-sdk/client-s3';

const timeoutMs = Number(process.env.INFRA_WAIT_TIMEOUT_MS ?? 60_000);
const started = Date.now();
const config = loadConfig();

async function wait(label: string, probe: () => Promise<void>): Promise<void> {
  let last = 'not started';
  while (Date.now() - started < timeoutMs) {
    try {
      await probe();
      console.log(`${label}: ready`);
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`${label} was not ready: ${last}`);
}

const pool = createPool(config.databaseUrl, 2_000);
const client = createS3Client(config.s3);
try {
  await wait('PostgreSQL', async () => {
    await pool.query('SELECT 1');
  });
  await wait('MinIO', async () => {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket })).catch(async (error) => {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return;
      throw error;
    });
  });
} finally {
  await pool.end().catch(() => undefined);
  client.destroy();
}

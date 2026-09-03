import { loadConfig } from '../config/env.js';
import { bootstrapObjectStorage } from '../storage/bootstrap.js';

const config = loadConfig();
const attempts = Number(process.env.STORAGE_BOOTSTRAP_ATTEMPTS ?? 30);
let lastError: unknown;
for (let index = 0; index < attempts; index += 1) {
  try {
    await bootstrapObjectStorage(config);
    console.log(`Object storage buckets ${config.s3.bucket} and ${config.s3.artworkBucket} are ready.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
console.error(lastError instanceof Error ? lastError.message : String(lastError));
process.exit(1);

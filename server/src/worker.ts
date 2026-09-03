import { parseFlagArgs } from './cli/args.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { FakeArtworkProcessor, createSharpArtworkProcessor } from './ingestion/artwork.js';
import { NNPM_PROBE_MISSING } from './ingestion/nnpmProbe.js';
import { createAudioProbe } from './ingestion/selectProbe.js';
import { IngestionWorker } from './ingestion/worker.js';
import { createITunesRemoteArtworkLookup } from './ingestion/remoteArtwork.js';
import { S3ObjectStorageSigner } from './storage/s3Signer.js';

const args = parseFlagArgs(process.argv.slice(2));
const once = args.once === true;

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const signer = new S3ObjectStorageSigner(config.s3);

let probe;
try {
  probe = await createAudioProbe(config);
} catch (error) {
  console.error(JSON.stringify({
    msg: 'worker_probe_unavailable',
    code: NNPM_PROBE_MISSING,
    error_code: NNPM_PROBE_MISSING,
    detail: error instanceof Error ? error.message : String(error),
  }));
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
  process.exit(1);
}

const artwork = await createSharpArtworkProcessor(
  config.uploadMaxArtworkBytes,
  config.artworkMaxPixels,
).catch((error) => {
  if (config.nodeEnv === 'test') {
    console.warn(JSON.stringify({ msg: 'artwork_processor_unavailable' }));
    return new FakeArtworkProcessor();
  }
  console.error(JSON.stringify({
    msg: 'artwork_processor_unavailable',
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
  process.exit(1);
});

const worker = new IngestionWorker({
  pool,
  config,
  signer,
  probe,
  artwork,
  remoteArtwork: createITunesRemoteArtworkLookup(),
});
const abort = new AbortController();

const shutdown = async (signal: string, code = 0) => {
  console.log(JSON.stringify({ msg: 'worker_shutting_down', signal }));
  abort.abort();
  await worker.releaseLease().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(code);
};

if (!once) {
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

if (once) {
  try {
    const stats = await worker.runOnce(config.workerOnceBatchSize);
    console.log(JSON.stringify({
      msg: 'worker_once_complete',
      claimed: stats.claimed,
      ready: stats.ready,
      failed: stats.failed,
      retried: stats.retried,
      cancelled: stats.cancelled,
    }));
    await worker.releaseLease();
    await pool.end();
    process.exit(stats.infrastructureError ? 1 : 0);
  } catch (error) {
    console.error(JSON.stringify({
      msg: 'worker_once_failed',
      error_code: 'INGESTION_FAILED',
      detail: error instanceof Error ? error.message : String(error),
    }));
    await worker.releaseLease().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
} else {
  console.log(JSON.stringify({
    msg: 'ingestion_worker_started',
    probe: config.nnpmProbePath,
    mode: config.mediaProbeMode,
  }));
  await worker.writeHeartbeat().catch(() => undefined);
  await worker.runLoop(abort.signal);
}

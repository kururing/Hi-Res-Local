import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../../src/config/env.js';
import { FakeArtworkProcessor } from '../../src/ingestion/artwork.js';
import { assertNnpmProbeAvailable, NnpmProbeAudioProbe } from '../../src/ingestion/nnpmProbe.js';
import { IngestionWorker } from '../../src/ingestion/worker.js';
import { createSyntheticWav } from '../../src/media/synthetic.js';
import { bootstrapObjectStorage, createS3Client } from '../../src/storage/bootstrap.js';
import { S3ObjectStorageSigner } from '../../src/storage/s3Signer.js';
import { nnpmProbeRequired, s3IntegrationRequired, setGate } from './flags.js';
import {
  getIntegration,
  grantCatalogAdmin,
  ORIGIN,
  uniqueEmail,
} from './helpers.js';

const handle = await getIntegration();
const config = testConfig({
  databaseUrl: handle.ready ? handle.config.databaseUrl : testConfig().databaseUrl,
  mediaProbeMode: 'nnpm',
});
const client = createS3Client(config.s3);
const signer = new S3ObjectStorageSigner(config.s3);
const runId = `live-${Date.now().toString(36)}`;
const createdKeys: string[] = [];
const createdUserIds: string[] = [];

let s3Ready = false;
let probeReady = false;
let s3Reason = 'MinIO was not probed.';
let probeReason = 'nnpm-probe was not checked.';

try {
  await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket })).catch(async (error) => {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return;
    throw error;
  });
  await bootstrapObjectStorage(config);
  s3Ready = true;
  setGate('s3', 'PASS');
} catch (error) {
  s3Reason = `MinIO is not reachable at ${config.s3.endpoint} (${error instanceof Error ? error.message : String(error)}).`;
  if (s3IntegrationRequired()) {
    setGate('s3', 'FAIL');
    throw new Error(s3Reason);
  }
  setGate('s3', 'SKIP');
}

try {
  await assertNnpmProbeAvailable(config.nnpmProbePath, config.nnpmProbeStartupTimeoutMs);
  probeReady = true;
  setGate('nnpmProbe', 'PASS');
} catch (error) {
  probeReason = error instanceof Error ? error.message : String(error);
  if (nnpmProbeRequired()) {
    setGate('nnpmProbe', 'FAIL');
    throw new Error(probeReason);
  }
  setGate('nnpmProbe', 'SKIP');
}

const ready = handle.ready && s3Ready && probeReady;
const describeLive = ready ? describe : describe.skip;

describeLive('admin import live MinIO/nnpm-probe', () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterAll(async () => {
    for (const key of createdKeys) {
      await signer.deleteObject(key).catch(() => undefined);
    }
    if (handle.ready) {
      for (const userId of createdUserIds) {
        await handle.pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
      }
    }
    await closeApp?.().catch(() => undefined);
    client.destroy();
  });

  it('uploads to MinIO, probes real tags, publishes, and streams a Range 206', async () => {
    if (!handle.ready) throw new Error(handle.reason);
    const liveConfig = {
      ...config,
      importReconcilePrefixes: [`integration/imports/${runId}/`],
    };
    const app = await buildApp({ config: liveConfig, pool: handle.pool, signer, logger: false });
    closeApp = () => app.close();
    const probe = new NnpmProbeAudioProbe(config.nnpmProbePath);
    const wav = createSyntheticWav({
      tags: {
        title: 'Live Harbor',
        artist: 'Live Circuit',
        album: 'Live Glass',
        year: '2026',
        genre: 'Electronic',
        track: '1',
      },
    });
    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        email: uniqueEmail(`import-live-${runId}`),
        password: 'correct-horse',
        display_name: 'Live Import',
      },
    });
    expect(registered.statusCode).toBe(201);
    const adminToken = registered.json().access_token as string;
    const adminId = registered.json().user.id as string;
    createdUserIds.push(adminId);
    await grantCatalogAdmin(handle.pool, adminId);

    const user = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        email: uniqueEmail(`import-live-user-${runId}`),
        password: 'correct-horse',
        display_name: 'Live User',
      },
    });
    createdUserIds.push(user.json().user.id as string);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: {
        authorization: `Bearer ${user.json().access_token}`,
        'content-type': 'application/json',
        origin: ORIGIN,
      },
      payload: {
        filename: 'live.wav',
        content_type: 'audio/wav',
        size_bytes: wav.size,
        checksum_sha256: wav.sha256,
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
        origin: ORIGIN,
        'idempotency-key': `live-${runId}`,
      },
      payload: {
        filename: 'Live Harbor.wav',
        content_type: 'audio/wav',
        size_bytes: wav.size,
        checksum_sha256: wav.sha256,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().upload.object_key).toBeNull();
    expect(JSON.stringify(created.json())).not.toContain('storage_key');
    const importId = created.json().import.id as string;
    const putUrl = created.json().upload.url as string;
    const putHeaders = new Headers(created.json().upload.headers ?? {});
    const uploaded = await fetch(putUrl, {
      method: 'PUT',
      headers: putHeaders,
      body: new Uint8Array(wav.body),
      credentials: 'omit',
    });
    expect(uploaded.ok).toBe(true);

    const keyRow = await handle.pool.query<{ object_key: string }>(
      'SELECT object_key FROM media_uploads WHERE id = $1',
      [created.json().upload.upload_id],
    );
    createdKeys.push(keyRow.rows[0]!.object_key);

    const complete = await app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${importId}/complete`,
      headers: { authorization: `Bearer ${adminToken}`, origin: ORIGIN },
    });
    expect(complete.statusCode).toBe(200);

    const worker = new IngestionWorker({
      pool: handle.pool,
      config: liveConfig,
      signer,
      probe,
      artwork: new FakeArtworkProcessor(),
      workerId: `live-${runId}`,
    });
    expect(await worker.processOne()).toBe(true);

    const viewed = await app.inject({
      method: 'GET',
      url: `/v1/admin/imports/${importId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().status).toBe('published');
    expect(viewed.json().effective.title).toBe('Live Harbor');
    const trackId = viewed.json().committed_track_id as string;
    expect(trackId).toBeTruthy();
    expect(JSON.stringify(viewed.json())).not.toContain('storage_key');

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${importId}/commit`,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(retry.json().committed_track_id).toBe(trackId);

    const catalog = await app.inject({
      method: 'GET',
      url: `/v1/catalog/tracks/${trackId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().title).toBe('Live Harbor');
    expect(JSON.stringify(catalog.json())).not.toContain('storage_key');

    const search = await app.inject({
      method: 'GET',
      url: '/v1/catalog/search?q=Live%20Harbor&type=track',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).toContain(trackId);

    const stream = await app.inject({
      method: 'POST',
      url: `/v1/tracks/${trackId}/stream`,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { quality: 'lossless' },
    });
    expect(stream.statusCode).toBe(200);
    const signedUrl = String(stream.json().url);
    const range = await fetch(signedUrl, {
      headers: { Range: 'bytes=0-1023' },
      credentials: 'omit',
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')?.startsWith('bytes 0-1023/')).toBe(true);
    expect(Buffer.from(await range.arrayBuffer()).length).toBe(1024);

    const otherAdmin = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: {
        email: uniqueEmail(`import-live-dup-${runId}`),
        password: 'correct-horse',
        display_name: 'Live Dup',
      },
    });
    createdUserIds.push(otherAdmin.json().user.id as string);
    await grantCatalogAdmin(handle.pool, otherAdmin.json().user.id as string);
    const otherToken = otherAdmin.json().access_token as string;
    const dupCreated = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: {
        authorization: `Bearer ${otherToken}`,
        'content-type': 'application/json',
        origin: ORIGIN,
        'idempotency-key': `live-dup-${runId}`,
      },
      payload: {
        filename: 'Live Harbor.wav',
        content_type: 'audio/wav',
        size_bytes: wav.size,
        checksum_sha256: wav.sha256,
      },
    });
    expect(dupCreated.statusCode).toBe(201);
    const dupPut = await fetch(dupCreated.json().upload.url as string, {
      method: 'PUT',
      headers: new Headers(dupCreated.json().upload.headers ?? {}),
      body: new Uint8Array(wav.body),
      credentials: 'omit',
    });
    expect(dupPut.ok).toBe(true);
    const dupKey = await handle.pool.query<{ object_key: string }>(
      'SELECT object_key FROM media_uploads WHERE id = $1',
      [dupCreated.json().upload.upload_id],
    );
    createdKeys.push(dupKey.rows[0]!.object_key);
    expect((await app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${dupCreated.json().import.id}/complete`,
      headers: { authorization: `Bearer ${otherToken}`, origin: ORIGIN },
    })).statusCode).toBe(200);
    expect(await worker.processOne()).toBe(true);
    const dupView = await app.inject({
      method: 'GET',
      url: `/v1/admin/imports/${dupCreated.json().import.id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(dupView.json().status).toBe('duplicate');
    expect(dupView.json().committed_track_id).toBe(trackId);
    const assetCount = await handle.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audio_assets WHERE checksum = $1 AND available = TRUE',
      [wav.sha256],
    );
    expect(assetCount.rows[0]?.n).toBe(1);

    const orphan = createSyntheticWav({
      frequencyHz: 880,
      tags: {
        title: 'Orphan Harbor',
        artist: 'Orphan Circuit',
        album: 'Orphan Glass',
        year: '2026',
      },
    });
    const orphanKey = `integration/imports/${runId}/orphan.wav`;
    await signer.putObject(orphanKey, { body: orphan.body, contentType: 'audio/wav' });
    createdKeys.push(orphanKey);
    const scanned = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports/reconcile',
      headers: { authorization: `Bearer ${adminToken}`, origin: ORIGIN },
    });
    expect(scanned.statusCode).toBe(200);
    expect(scanned.json().enqueued).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(scanned.json())).not.toContain(orphanKey);
    expect(await worker.processOne()).toBe(true);
    const orphanRow = await handle.pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM audio_imports WHERE object_key = $1',
      [orphanKey],
    );
    expect(['published', 'duplicate']).toContain(orphanRow.rows[0]?.status);
    const scannedAgain = await app.inject({
      method: 'POST',
      url: '/v1/admin/imports/reconcile',
      headers: { authorization: `Bearer ${adminToken}`, origin: ORIGIN },
    });
    expect(scannedAgain.json().enqueued).toBe(0);
  });
});

if (!ready) {
  describe('admin import live MinIO/nnpm-probe (skipped)', () => {
    afterAll(() => {
      client.destroy();
    });
    it('documents why the live import path did not run', () => {
      if (!handle.ready) expect(handle.reason).toBeTruthy();
      else if (!s3Ready) expect(s3Reason).toBeTruthy();
      else expect(probeReason).toBeTruthy();
    });
  });
}

import { afterAll, describe, expect, it } from 'vitest';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { testConfig } from '../../src/config/env.js';
import { createSyntheticWav } from '../../src/media/synthetic.js';
import {
  bootstrapObjectStorage,
  createS3Client,
  readBucketCors,
  readBucketPolicy,
} from '../../src/storage/bootstrap.js';
import { isMissingBucketCorsError } from '../../src/storage/bucketCors.js';
import { S3ObjectStorageSigner } from '../../src/storage/s3Signer.js';
import { s3IntegrationRequired, setGate } from './flags.js';

const config = testConfig();
const client = createS3Client(config.s3);
const signer = new S3ObjectStorageSigner(config.s3);
const wav = createSyntheticWav();
const key = `integration/s3/${Date.now()}-live.wav`;

let ready = false;
let reason = 'MinIO was not probed.';

try {
  await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket })).catch(async (error) => {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      return;
    }
    throw error;
  });
  await bootstrapObjectStorage(config);
  ready = true;
  setGate('s3', 'PASS');
} catch (error) {
  reason = `MinIO is not reachable at ${config.s3.endpoint} (${error instanceof Error ? error.message : String(error)}).`;
  if (s3IntegrationRequired()) {
    setGate('s3', 'FAIL');
    throw new Error(reason);
  }
  setGate('s3', 'SKIP');
}

const describeS3 = ready ? describe : describe.skip;

describeS3('S3/MinIO live integration', () => {
  afterAll(async () => {
    await signer.deleteObject(key).catch(() => undefined);
    client.destroy();
  });

  it('presigns PUT, stores a synthetic WAV, and verifies head metadata', async () => {
    const put = await signer.createPutUrl(key, config.presignPutTtlSeconds, {
      contentType: 'audio/wav',
      contentLength: wav.size,
      checksumSha256: wav.sha256,
    });
    expect(put.url).toContain(config.s3.publicEndpoint.replace(/\/+$/, '').split('://')[1] ?? '');
    const uploaded = await fetch(put.url, {
      method: 'PUT',
      headers: put.headers,
      body: new Uint8Array(wav.body),
      credentials: 'omit',
    });
    expect(uploaded.ok).toBe(true);

    const head = await signer.headObject(key);
    expect(head.exists).toBe(true);
    expect(head.contentLength).toBe(wav.size);
    expect(head.contentType).toMatch(/audio\/wav|binary\/octet-stream|application\/octet-stream/);

    const stream = await signer.getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).length).toBe(wav.size);
  });

  it('issues a signed GET that supports HTTP Range and rejects anonymous audio reads', async () => {
    const signed = await signer.createReadUrl(key, config.signedUrlTtlSeconds, { contentType: 'audio/wav' });
    const expiresIn = signed.expiresAt.getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(30_000);
    expect(expiresIn).toBeLessThanOrEqual(config.signedUrlTtlSeconds * 1000 + 2_000);

    const ranged = await fetch(signed.url, { headers: { Range: 'bytes=0-1023' }, credentials: 'omit' });
    expect(ranged.status).toBe(206);
    expect(String(ranged.headers.get('accept-ranges') ?? '').toLowerCase()).toContain('bytes');
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-1023\//);
    expect((await ranged.arrayBuffer()).byteLength).toBe(1024);

    const anonymous = await fetch(`${config.s3.publicEndpoint.replace(/\/+$/, '')}/${config.s3.bucket}/${key}`, {
      credentials: 'omit',
    });
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
  });

  it('applies CORS and public artwork policy without logging credentials', async () => {
    const origin = config.corsOrigins[0];
    const objectUrl = `${config.s3.publicEndpoint.replace(/\/+$/, '')}/${config.s3.bucket}/${key}`;
    const preflight = await fetch(objectUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'range',
      },
    });
    expect([200, 204]).toContain(preflight.status);
    const allowedOrigin = preflight.headers.get('access-control-allow-origin');
    expect(allowedOrigin === origin || allowedOrigin === '*').toBe(true);

    try {
      const cors = await readBucketCors(client, config.s3.bucket);
      const origins = cors.CORSRules?.[0]?.AllowedOrigins ?? [];
      expect(origins).toEqual(expect.arrayContaining(config.corsOrigins));
      expect(cors.CORSRules?.[0]?.AllowedMethods).toEqual(expect.arrayContaining(['GET', 'HEAD', 'PUT']));
      expect(cors.CORSRules?.[0]?.AllowedHeaders).toEqual(expect.arrayContaining(['Range', 'Content-Type']));
    } catch (error) {
      if (config.s3.compatibility !== 'minio' || !isMissingBucketCorsError(error)) {
        throw error;
      }
    }

    const policy = await readBucketPolicy(client, config.s3.artworkBucket);
    expect(policy).toContain(config.s3.artworkBucket);
    expect(policy).toContain('s3:GetObject');

    const audioPolicy = await readBucketPolicy(client, config.s3.bucket);
    expect(audioPolicy ?? '').not.toContain(`arn:aws:s3:::${config.s3.bucket}/*`);

    const serialized = JSON.stringify({ put: await signer.createPutUrl(`${key}-cors`, 60, { contentType: 'audio/wav' }) });
    const withoutCredential = serialized.replace(/X-Amz-Credential=[^&"]+/g, 'X-Amz-Credential=[Redacted]');
    expect(withoutCredential).not.toContain(config.s3.secretAccessKey);
    expect(withoutCredential).not.toContain(config.s3.accessKeyId);
    await signer.deleteObject(`${key}-cors`).catch(() => undefined);
  });

  it('cancels leftover objects', async () => {
    const cancelKey = `${key}-cancel`;
    await signer.putObject(cancelKey, { body: wav.body, contentType: 'audio/wav' });
    await signer.deleteObject(cancelKey);
    const head = await signer.headObject(cancelKey);
    expect(head.exists).toBe(false);
  });
});

if (!ready) {
  client.destroy();
  describe('S3/MinIO live integration (skipped)', () => {
    it('documents why live storage tests did not run', () => {
      if (s3IntegrationRequired()) throw new Error(reason);
      expect(reason).toMatch(/MinIO/);
    });
  });
}

import { describe, expect, it } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { resolveStorageCompatibility, testConfig } from '../../src/config/env.js';
import { bootstrapObjectStorageWithClient } from '../../src/storage/bootstrap.js';
import { isMissingBucketCorsError, isUnsupportedBucketCorsError } from '../../src/storage/bucketCors.js';

function notImplementedCors(): Error {
  const error = new Error('A header you provided implies functionality that is not implemented');
  error.name = 'NotImplemented';
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata = { httpStatusCode: 501 };
  return error;
}

function fakeClient(handler: (name: string) => Promise<unknown> | unknown): S3Client {
  return {
    send: async (command: { constructor: { name: string } }) => handler(command.constructor.name),
    destroy() {},
  } as unknown as S3Client;
}

describe('object storage bootstrap compatibility', () => {
  it('selects AWS compatibility only for Amazon S3 or an explicit aws mode', () => {
    expect(resolveStorageCompatibility('aws', 'http://127.0.0.1:9000')).toBe('aws');
    expect(resolveStorageCompatibility(undefined, 'https://s3.us-east-1.amazonaws.com')).toBe('aws');
    expect(resolveStorageCompatibility(undefined, 'http://127.0.0.1:9000')).toBe('minio');
    expect(resolveStorageCompatibility('minio', 'https://s3.us-east-1.amazonaws.com')).toBe('minio');
  });

  it('treats MinIO NotImplemented CORS as unsupported', () => {
    expect(isUnsupportedBucketCorsError(notImplementedCors())).toBe(true);
    expect(isUnsupportedBucketCorsError(new Error('decoding xml: EOF'))).toBe(true);
    const malformed = new Error('MalformedXML');
    malformed.name = 'MalformedXML';
    expect(isUnsupportedBucketCorsError(malformed)).toBe(true);
    expect(isUnsupportedBucketCorsError(new Error('AccessDenied'))).toBe(false);
    const missing = new Error('The CORS configuration does not exist');
    missing.name = 'NoSuchCORSConfiguration';
    expect(isMissingBucketCorsError(missing)).toBe(true);
  });

  it('skips unsupported per-bucket CORS in MinIO mode and still checks buckets and policy', async () => {
    const calls: string[] = [];
    const client = fakeClient((name) => {
      calls.push(name);
      if (name === 'PutBucketCorsCommand') throw notImplementedCors();
      return {};
    });

    await bootstrapObjectStorageWithClient(client, testConfig({
      s3: { ...testConfig().s3, compatibility: 'minio' },
    }));

    expect(calls.filter((name) => name === 'HeadBucketCommand')).toHaveLength(2);
    expect(calls.filter((name) => name === 'PutBucketCorsCommand')).toHaveLength(2);
    expect(calls).toContain('PutBucketPolicyCommand');
  });

  it('still calls PutBucketCors in AWS mode and fails when it is not implemented', async () => {
    const calls: string[] = [];
    const client = fakeClient((name) => {
      calls.push(name);
      if (name === 'PutBucketCorsCommand') throw notImplementedCors();
      return {};
    });

    await expect(bootstrapObjectStorageWithClient(client, testConfig({
      s3: { ...testConfig().s3, compatibility: 'aws' },
    }))).rejects.toThrow(/not implemented/i);
    expect(calls).toContain('PutBucketCorsCommand');
  });

  it('fails bootstrap on storage errors other than MinIO CORS compatibility', async () => {
    const client = fakeClient((name) => {
      if (name === 'PutBucketCorsCommand') throw new Error('AccessDenied: cannot write CORS');
      return {};
    });

    await expect(bootstrapObjectStorageWithClient(client, testConfig({
      s3: { ...testConfig().s3, compatibility: 'minio' },
    }))).rejects.toThrow(/AccessDenied/);
  });

  it('does not swallow bucket existence failures', async () => {
    const client = fakeClient((name) => {
      if (name === 'HeadBucketCommand') {
        const error = new Error('ECONNREFUSED');
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata = { httpStatusCode: 500 };
        throw error;
      }
      return {};
    });

    await expect(bootstrapObjectStorageWithClient(client, testConfig({
      s3: { ...testConfig().s3, compatibility: 'minio' },
    }))).rejects.toThrow(/ECONNREFUSED/);
  });
});

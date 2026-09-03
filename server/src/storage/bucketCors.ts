import { PutBucketCorsCommand, type S3Client } from '@aws-sdk/client-s3';
import type { StorageCompatibility } from '../config/env.js';

export const STORAGE_CORS_EXPOSE_HEADERS = [
  'Accept-Ranges',
  'Content-Length',
  'Content-Range',
  'Content-Type',
  'ETag',
] as const;

/**
 * Allow browser media elements to GET/HEAD Range requests against original
 * objects. Origins are an allowlist — never `*` with credentials.
 */
export async function applyBucketCors(
  client: S3Client,
  bucket: string,
  origins: string[],
): Promise<void> {
  const allowedOrigins = origins.map((origin) => origin.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    throw new Error('Object storage CORS requires at least one origin.');
  }
  if (allowedOrigins.includes('*')) {
    throw new Error('Object storage CORS cannot use a wildcard origin.');
  }

  await client.send(new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: allowedOrigins,
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['Range', 'Content-Type', 'Content-Length', 'x-amz-checksum-sha256', 'x-amz-content-sha256'],
          ExposeHeaders: [...STORAGE_CORS_EXPOSE_HEADERS],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }));
}

function errorName(error: unknown): string {
  return (error as { name?: string }).name ?? '';
}

function errorCode(error: unknown): string {
  return (error as { Code?: string; code?: string }).Code
    ?? (error as { code?: string }).code
    ?? '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isUnsupportedBucketCorsError(error: unknown): boolean {
  const name = errorName(error);
  const code = errorCode(error);
  const message = errorMessage(error);
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotImplemented'
    || name === 'MalformedXML'
    || code === 'NotImplemented'
    || code === 'MalformedXML'
    || status === 501
    || /functionality that is not implemented/i.test(message)
    || /not implemented/i.test(message)
    || /decoding xml: eof/i.test(message)
    || /malformed xml/i.test(message);
}

export function isMissingBucketCorsError(error: unknown): boolean {
  const name = errorName(error);
  const code = errorCode(error);
  const message = errorMessage(error);
  return isUnsupportedBucketCorsError(error)
    || name === 'NoSuchCORSConfiguration'
    || code === 'NoSuchCORSConfiguration'
    || /CORS configuration does not exist/i.test(message);
}

/**
 * AWS S3 always applies per-bucket CORS. MinIO-compatible mode still calls
 * PutBucketCors, then ignores only the documented "not implemented" response
 * so global server CORS can be used instead.
 */
export async function applyCompatibleBucketCors(
  client: S3Client,
  bucket: string,
  origins: string[],
  compatibility: StorageCompatibility,
): Promise<'applied' | 'skipped'> {
  try {
    await applyBucketCors(client, bucket, origins);
    return 'applied';
  } catch (error) {
    if (compatibility === 'minio' && isUnsupportedBucketCorsError(error)) {
      return 'skipped';
    }
    throw error;
  }
}

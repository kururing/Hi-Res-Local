import {
  CreateBucketCommand,
  GetBucketCorsCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/env.js';
import { applyCompatibleBucketCors, STORAGE_CORS_EXPOSE_HEADERS } from './bucketCors.js';

export function createS3Client(config: AppConfig['s3']): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404 && status !== 403) {
      throw error;
    }
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (createError) {
      const name = (createError as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
        throw createError;
      }
    }
  }
}

export function artworkPublicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicArtworkRead',
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

export async function applyArtworkPublicRead(client: S3Client, bucket: string): Promise<void> {
  await client.send(new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: artworkPublicReadPolicy(bucket),
  }));
}

export async function bootstrapObjectStorageWithClient(client: S3Client, config: AppConfig): Promise<void> {
  await ensureBucket(client, config.s3.bucket);
  await ensureBucket(client, config.s3.artworkBucket);
  await applyCompatibleBucketCors(client, config.s3.bucket, config.corsOrigins, config.s3.compatibility);
  await applyCompatibleBucketCors(client, config.s3.artworkBucket, config.corsOrigins, config.s3.compatibility);
  await applyArtworkPublicRead(client, config.s3.artworkBucket);
}

export async function bootstrapObjectStorage(config: AppConfig): Promise<void> {
  const client = createS3Client(config.s3);
  try {
    await bootstrapObjectStorageWithClient(client, config);
  } finally {
    client.destroy();
  }
}

export async function readBucketCors(client: S3Client, bucket: string) {
  return client.send(new GetBucketCorsCommand({ Bucket: bucket }));
}

export async function readBucketPolicy(client: S3Client, bucket: string): Promise<string | null> {
  try {
    const result = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    return result.Policy ?? null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

export { STORAGE_CORS_EXPOSE_HEADERS };

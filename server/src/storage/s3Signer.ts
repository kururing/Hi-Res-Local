import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from '../config/env.js';
import { hexToChecksumBase64, normalizeSha256 } from '../ingestion/checksum.js';
import { rewriteStorageUrl } from './publicUrl.js';
import type {
  ListedObject,
  ObjectHead,
  ObjectStorageSigner,
  PutObjectInput,
  SignPutUrlOptions,
  SignReadUrlOptions,
  SignedObjectUrl,
  SignedPutUrl,
} from './signer.js';

function s3Client(options: S3Config, endpoint: string): S3Client {
  return new S3Client({
    region: options.region,
    endpoint,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });
}

export class S3ObjectStorageSigner implements ObjectStorageSigner {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;

  constructor(private readonly options: S3Config) {
    this.client = s3Client(options, options.endpoint);
    this.signingClient = options.publicEndpoint === options.endpoint
      ? this.client
      : s3Client(options, options.publicEndpoint);
  }

  private publicize(url: string): string {
    return rewriteStorageUrl(url, this.options.publicEndpoint, this.options.endpoint);
  }

  private bucket(override?: string): string {
    return override ?? this.options.bucket;
  }

  async createReadUrl(
    storageKey: string,
    expiresInSeconds: number,
    options?: SignReadUrlOptions,
  ): Promise<SignedObjectUrl> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: storageKey,
      ResponseContentType: options?.contentType,
    });
    const url = await getSignedUrl(this.signingClient, command, { expiresIn: expiresInSeconds });
    return {
      url: this.publicize(url),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async createPutUrl(
    storageKey: string,
    expiresInSeconds: number,
    options: SignPutUrlOptions,
    bucket?: string,
  ): Promise<SignedPutUrl> {
    const checksum = options.checksumSha256 ? hexToChecksumBase64(options.checksumSha256) : undefined;
    const command = new PutObjectCommand({
      Bucket: this.bucket(bucket),
      Key: storageKey,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.signingClient, command, { expiresIn: expiresInSeconds });
    const headers: Record<string, string> = { 'content-type': options.contentType };
    if (checksum) headers['x-amz-checksum-sha256'] = checksum;
    return {
      url: this.publicize(url),
      headers,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async headObject(storageKey: string, bucket?: string): Promise<ObjectHead> {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket(bucket),
        Key: storageKey,
        ChecksumMode: 'ENABLED',
      }));
      return {
        exists: true,
        contentLength: result.ContentLength ?? null,
        checksumSha256: result.ChecksumSHA256 ? normalizeSha256(result.ChecksumSHA256) : null,
        etag: result.ETag ?? null,
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) {
        return { exists: false, contentLength: null, checksumSha256: null, etag: null, contentType: null };
      }
      throw error;
    }
  }

  async deleteObject(storageKey: string, bucket?: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket(bucket),
      Key: storageKey,
    }));
  }

  async getObjectStream(storageKey: string, bucket?: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket(bucket),
      Key: storageKey,
    }));
    const body = result.Body;
    if (!body) throw new Error('object_body_missing');
    if (body instanceof Readable) return body;
    throw new Error('object_body_not_stream');
  }

  async putObject(storageKey: string, input: PutObjectInput, bucket?: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket(bucket),
      Key: storageKey,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
    }));
  }

  async *listObjects(prefix: string, bucket?: string): AsyncIterable<ListedObject> {
    let token: string | undefined;
    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket(bucket),
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }));
      for (const item of result.Contents ?? []) {
        if (!item.Key) continue;
        yield { key: item.Key, size: item.Size ?? null };
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.options.bucket }),
      { abortSignal: signal },
    );
  }
}

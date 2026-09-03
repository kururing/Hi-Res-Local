import { Readable } from 'node:stream';
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

interface StoredObject {
  body: Buffer;
  contentType: string;
  checksumSha256?: string;
}

function objectKey(bucket: string, storageKey: string): string {
  return `${bucket}:${storageKey}`;
}

export class FakeObjectStorageSigner implements ObjectStorageSigner {
  readonly calls: Array<{
    storageKey: string;
    expiresInSeconds: number;
    contentType?: string;
  }> = [];
  failPing = false;
  private readonly objects = new Map<string, StoredObject>();
  readonly defaultBucket: string;

  constructor(defaultBucket = 'nghenhacpromax') {
    this.defaultBucket = defaultBucket;
  }

  put(storageKey: string, body: Buffer, options?: { contentType?: string; checksumSha256?: string; bucket?: string }): void {
    this.objects.set(objectKey(options?.bucket ?? this.defaultBucket, storageKey), {
      body,
      contentType: options?.contentType ?? 'application/octet-stream',
      checksumSha256: options?.checksumSha256,
    });
  }

  getStored(storageKey: string, bucket?: string): StoredObject | undefined {
    return this.objects.get(objectKey(bucket ?? this.defaultBucket, storageKey));
  }

  keys(bucket?: string): string[] {
    const prefix = `${bucket ?? this.defaultBucket}:`;
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  async createReadUrl(
    storageKey: string,
    expiresInSeconds: number,
    options?: SignReadUrlOptions,
  ): Promise<SignedObjectUrl> {
    this.calls.push({
      storageKey,
      expiresInSeconds,
      contentType: options?.contentType,
    });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    return {
      url: `https://storage.test/object/${encodeURIComponent(storageKey)}?sig=fake&exp=${expiresAt.getTime()}`,
      expiresAt,
    };
  }

  async createPutUrl(
    storageKey: string,
    expiresInSeconds: number,
    options: SignPutUrlOptions,
    _bucket?: string,
  ): Promise<SignedPutUrl> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const headers: Record<string, string> = { 'content-type': options.contentType };
    if (options.checksumSha256) {
      headers['x-amz-checksum-sha256'] = Buffer.from(options.checksumSha256, 'hex').toString('base64');
    }
    return {
      url: `https://storage.test/upload/${encodeURIComponent(storageKey)}?sig=fake-put&exp=${expiresAt.getTime()}`,
      headers,
      expiresAt,
    };
  }

  async headObject(storageKey: string, bucket?: string): Promise<ObjectHead> {
    const stored = this.getStored(storageKey, bucket);
    if (!stored) {
      return { exists: false, contentLength: null, checksumSha256: null, etag: null, contentType: null };
    }
    return {
      exists: true,
      contentLength: stored.body.length,
      checksumSha256: stored.checksumSha256 ?? null,
      etag: `"${stored.body.length.toString(16)}"`,
      contentType: stored.contentType,
    };
  }

  clear(): void {
    this.objects.clear();
  }

  async deleteObject(storageKey: string, bucket?: string): Promise<void> {
    this.objects.delete(objectKey(bucket ?? this.defaultBucket, storageKey));
  }

  async getObjectStream(storageKey: string, bucket?: string): Promise<NodeJS.ReadableStream> {
    const stored = this.getStored(storageKey, bucket);
    if (!stored) {
      throw new Error('object_not_found');
    }
    return Readable.from(stored.body);
  }

  async putObject(storageKey: string, input: PutObjectInput, bucket?: string): Promise<void> {
    this.put(storageKey, Buffer.from(input.body), { contentType: input.contentType, bucket });
  }

  async *listObjects(prefix: string, bucket?: string): AsyncIterable<ListedObject> {
    for (const key of this.keys(bucket)) {
      if (prefix && !key.startsWith(prefix)) continue;
      const stored = this.getStored(key, bucket);
      yield { key, size: stored?.body.length ?? null };
    }
  }

  async ping(_signal?: AbortSignal): Promise<void> {
    if (this.failPing) {
      throw new Error('storage ping failed');
    }
  }
}

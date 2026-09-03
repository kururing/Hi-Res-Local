export interface SignedObjectUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Signs short-lived read URLs for original objects. Implementations must not
 * transcode, decode, or rewrite audio bytes.
 */
export interface SignReadUrlOptions {
  contentType?: string;
}

export interface SignPutUrlOptions {
  contentType: string;
  contentLength?: number;
  checksumSha256?: string;
}

export interface SignedPutUrl {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectHead {
  exists: boolean;
  contentLength: number | null;
  checksumSha256: string | null;
  etag: string | null;
  contentType: string | null;
}

export interface ListedObject {
  key: string;
  size: number | null;
}

export interface PutObjectInput {
  body: Buffer | Uint8Array;
  contentType: string;
  cacheControl?: string;
}

export interface ObjectStorageSigner {
  createReadUrl(
    storageKey: string,
    expiresInSeconds: number,
    options?: SignReadUrlOptions,
  ): Promise<SignedObjectUrl>;
  ping(signal?: AbortSignal): Promise<void>;
  createPutUrl?(
    storageKey: string,
    expiresInSeconds: number,
    options: SignPutUrlOptions,
    bucket?: string,
  ): Promise<SignedPutUrl>;
  headObject?(storageKey: string, bucket?: string): Promise<ObjectHead>;
  deleteObject?(storageKey: string, bucket?: string): Promise<void>;
  getObjectStream?(storageKey: string, bucket?: string): Promise<NodeJS.ReadableStream>;
  putObject?(storageKey: string, input: PutObjectInput, bucket?: string): Promise<void>;
  listObjects?(prefix: string, bucket?: string): AsyncIterable<ListedObject>;
}

export function requireObjectStore(signer: ObjectStorageSigner): Required<ObjectStorageSigner> {
  if (
    !signer.createPutUrl
    || !signer.headObject
    || !signer.deleteObject
    || !signer.getObjectStream
    || !signer.putObject
  ) {
    throw new Error('Object storage implementation is missing write/head/delete methods.');
  }
  return signer as Required<ObjectStorageSigner>;
}

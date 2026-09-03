import type { ObjectStorageSigner } from './signer.js';

/** Worker-facing object metadata. Never used to serve bytes through Fastify. */
export interface MediaObjectMetadata {
  contentLength: number | null;
  checksumSha256: string | null;
  contentType: string | null;
  etag: string | null;
}

export async function mediaObjectMetadata(
  signer: ObjectStorageSigner,
  storageKey: string,
  bucket?: string,
): Promise<MediaObjectMetadata | null> {
  if (!signer.headObject) return null;
  const head = await signer.headObject(storageKey, bucket);
  if (!head.exists) return null;
  return {
    contentLength: head.contentLength,
    checksumSha256: head.checksumSha256,
    contentType: head.contentType,
    etag: head.etag,
  };
}

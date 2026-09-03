import { describe, expect, it } from 'vitest';
import { FakeObjectStorageSigner } from '../../src/storage/fakeSigner.js';
import { mediaObjectMetadata } from '../../src/storage/metadata.js';

describe('media object metadata', () => {
  it('reads headObject without exposing a byte stream', async () => {
    const signer = new FakeObjectStorageSigner();
    signer.put('catalog/a.flac', Buffer.from('flac'), { contentType: 'audio/flac', checksumSha256: 'ab' });
    await expect(mediaObjectMetadata(signer, 'missing')).resolves.toBeNull();
    await expect(mediaObjectMetadata(signer, 'catalog/a.flac')).resolves.toEqual({
      contentLength: 4,
      checksumSha256: 'ab',
      contentType: 'audio/flac',
      etag: expect.any(String),
    });
  });
});

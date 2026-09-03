import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  hexToChecksumBase64,
  isLikelyMultipartEtag,
  normalizeSha256,
  sha256Hex,
  sha256HexFromStream,
  tryNormalizeSha256,
} from '../../src/ingestion/checksum.js';

describe('checksum helpers', () => {
  it('normalizes hex and base64 SHA-256 to lowercase hex', () => {
    const hex = sha256Hex('hello');
    expect(normalizeSha256(hex.toUpperCase())).toBe(hex);
    expect(normalizeSha256(`sha256:${hex}`)).toBe(hex);
    expect(normalizeSha256(hexToChecksumBase64(hex))).toBe(hex);
  });

  it('rejects invalid checksums and multipart ETags', () => {
    expect(tryNormalizeSha256('not-a-hash')).toBeNull();
    expect(isLikelyMultipartEtag('"abc-2"')).toBe(true);
    expect(isLikelyMultipartEtag('"abc"')).toBe(false);
  });

  it('hashes a stream and refuses oversized payloads', async () => {
    const hex = sha256Hex('hello');
    await expect(sha256HexFromStream(Readable.from(['hello']), 1024)).resolves.toEqual({
      checksum: hex,
      size: 5,
    });
    await expect(sha256HexFromStream(Readable.from(['hello']), 4)).resolves.toBeNull();
  });
});

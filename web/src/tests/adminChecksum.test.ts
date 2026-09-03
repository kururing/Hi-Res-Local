import { describe, expect, it } from 'vitest';
import { bytesToHex, hashFileSha256 } from '../admin/checksum';
import { IncrementalSha256 } from '../admin/sha256';
import { AdminUploadSession } from '../admin/uploadSession';

async function webCryptoSha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return bytesToHex(new Uint8Array(digest));
}

describe('incremental SHA-256', () => {
  it('matches Web Crypto for chunked input and reports progress', async () => {
    const bytes = new Uint8Array(3000).map((_, index) => index % 251);
    const file = new Blob([bytes]);
    const percents: number[] = [];
    const hex = await hashFileSha256(file, {
      chunkSize: 1024,
      onProgress: progress => percents.push(progress.percent),
    });
    expect(hex).toBe(await webCryptoSha256(bytes));
    expect(percents.at(-1)).toBe(100);
    expect(percents.length).toBeGreaterThan(1);
  });

  it('can be cancelled without blocking', async () => {
    const controller = new AbortController();
    const file = new Blob([new Uint8Array(2_000_000)]);
    const pending = hashFileSha256(file, { chunkSize: 1024, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('hashes incrementally through IncrementalSha256', () => {
    const hasher = new IncrementalSha256();
    hasher.update(new Uint8Array([1, 2]));
    hasher.update(new Uint8Array([3, 4]));
    expect(hasher.digest()).toBeInstanceOf(Uint8Array);
  });
});

describe('admin upload session', () => {
  it('does not persist presigned URLs and isolates generations', () => {
    const session = new AdminUploadSession();
    const first = session.start();
    session.rememberUrl('https://storage.test/presigned?sig=1');
    expect(session.hasPersistedUrl()).toBe(false);
    const second = session.start();
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(session.hasPersistedUrl()).toBe(false);
  });
});

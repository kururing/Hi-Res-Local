import { describe, expect, it, vi } from 'vitest';
import { ObjectUploadTransport } from '../admin/ObjectUploadTransport';
import type { PresignedUpload } from '../platform/admin/types';

const upload: PresignedUpload = {
  upload_id: 'upload-1',
  method: 'PUT',
  url: 'https://storage.test/object',
  headers: { 'content-type': 'audio/flac' },
  expires_at: '2026-01-01T00:15:00.000Z',
  object_key: null,
};

describe('ObjectUploadTransport', () => {
  it('PUTs with only server-supplied headers and omits credentials', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      expect(init?.method).toBe('PUT');
      const headers = new Headers(init?.headers);
      expect(headers.get('content-type')).toBe('audio/flac');
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('cookie')).toBeNull();
      return new Response(null, { status: 200 });
    });
    const transport = new ObjectUploadTransport(fetcher as unknown as typeof fetch);
    await transport.put({
      upload,
      body: new Blob([new Uint8Array([1, 2, 3])]),
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(upload.url);
  });

  it('retries a safe 503 once and then succeeds', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 503 : 200 });
    });
    const transport = new ObjectUploadTransport(fetcher as unknown as typeof fetch);
    await transport.put({
      upload,
      body: new Blob([new Uint8Array([1])]),
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

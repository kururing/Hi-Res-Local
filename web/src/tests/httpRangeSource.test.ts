import { describe, expect, it, vi } from 'vitest';
import { HttpRangeSource } from '../audio/source/HttpRangeSource';
import { MAX_BOUNDED_WHOLE_FILE_BYTES, parseRangeRequestHeader } from '../audio/source/types';
import { PlaybackError } from '../audio/browserErrors';

function flacLike(size: number, fill = 0x66): Uint8Array {
  const bytes = new Uint8Array(Math.min(size, 4 * 1024 * 1024));
  bytes.set([0x66, 0x4c, 0x61, 0x43]);
  bytes.fill(fill, 4);
  return bytes;
}

function bodyInit(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

function rangeResponse(
  store: Uint8Array,
  advertisedSize: number,
  init?: RequestInit,
): Response {
  const range = parseRangeRequestHeader(
    init?.headers instanceof Headers
      ? init.headers.get('Range')
      : typeof init?.headers === 'object' && init.headers && 'Range' in init.headers
        ? String((init.headers as Record<string, string>).Range)
        : null,
  );
  if (!range) {
    return new Response(bodyInit(store), {
      status: 200,
      headers: { 'Content-Length': String(advertisedSize), 'Content-Type': 'audio/flac' },
    });
  }
  const start = Math.min(range.start, Math.max(0, advertisedSize - 1));
  const end = Math.min(
    Number.isFinite(range.end) ? range.end : start + 255,
    advertisedSize - 1,
  );
  const length = Math.max(0, end - start + 1);
  const body = new Uint8Array(length);
  if (start < store.length) {
    body.set(store.subarray(start, Math.min(store.length, end + 1)));
  }
  return new Response(bodyInit(body), {
    status: 206,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${advertisedSize}`,
      'Content-Type': 'audio/flac',
    },
  });
}

describe('HttpRangeSource', () => {
  it('never issues a whole-object GET for a 1 GB FLAC and keeps RAM far below file size', async () => {
    const advertised = 1024 * 1024 * 1024;
    const store = flacLike(1024 * 1024);
    const requests: Array<{ range: string | null; url: string }> = [];
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      requests.push({ range: headers.get('Range'), url });
      return rangeResponse(store, advertised, init);
    }) as typeof fetch;

    const source = new HttpRangeSource({
      urlProvider: async () => 'https://storage.example.test/hires.flac?sig=1',
      fetchImpl,
    });
    await source.read(0, 16);
    const nearEnd = Math.floor(advertised * 0.8);
    await source.read(nearEnd, 64);

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(item => item.range && item.range.startsWith('bytes='))).toBe(true);
    expect(requests.some(item => item.range === `bytes=0-${advertised - 1}`)).toBe(false);
    expect(requests.some(item => !item.range)).toBe(false);
    const seekRanges = requests.map(item => parseRangeRequestHeader(item.range)).filter(Boolean);
    expect(seekRanges.some(range => range && range.start >= advertised * 0.75)).toBe(true);
    expect(source.cachedByteCount()).toBeLessThan(4 * 1024 * 1024);
    expect(source.cachedByteCount()).toBeLessThan(advertised / 100);
    expect(source.size()).toBe(advertised);
  });

  it('refreshes an expired signed URL and retries the same Range', async () => {
    const store = flacLike(4096);
    let issued = 0;
    const urls: string[] = [];
    const ranges: string[] = [];
    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      const range = headers.get('Range') ?? '';
      urls.push(String(input));
      ranges.push(range);
      if (String(input).includes('sig=old')) {
        return new Response(null, { status: 403 });
      }
      return rangeResponse(store, store.length, init);
    }) as typeof fetch;

    const source = new HttpRangeSource({
      urlProvider: async () => {
        issued += 1;
        return issued === 1
          ? 'https://storage.example.test/a.flac?sig=old'
          : 'https://storage.example.test/a.flac?sig=new';
      },
      fetchImpl,
    });
    const bytes = await source.read(0, 8);
    expect([...bytes.slice(0, 4)]).toEqual([0x66, 0x4c, 0x61, 0x43]);
    expect(urls[0]).toContain('sig=old');
    expect(urls.some(value => value.includes('sig=new'))).toBe(true);
    expect(ranges[0]).toMatch(/^bytes=0-/);
    expect(ranges.filter(value => value === ranges[0]).length).toBeGreaterThanOrEqual(2);
  });

  it('fails clearly when a Range request is answered with a huge 200 body', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(bodyInit(new Uint8Array([1, 2, 3])), {
      status: 200,
      headers: { 'Content-Length': String(900 * 1024 * 1024) },
    })) as typeof fetch;
    const source = new HttpRangeSource({
      urlProvider: async () => 'https://storage.example.test/huge.flac',
      fetchImpl,
    });
    await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'RANGE_REQUIRED' });
  });

  it('aborts in-flight Range fetches on seek epoch and does not reuse stale bodies', async () => {
    let release: () => void = () => undefined;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const fetchImpl: typeof fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      await new Promise<void>((resolve, reject) => {
        const fail = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };
        init?.signal?.addEventListener('abort', fail, { once: true });
        void blocked.then(() => {
          init?.signal?.removeEventListener('abort', fail);
          resolve();
        });
      });
      return rangeResponse(flacLike(4096), 4096, init);
    }) as typeof fetch;

    const source = new HttpRangeSource({
      urlProvider: async () => 'https://storage.example.test/a.flac',
      fetchImpl,
    });
    const pending = source.read(0, 16);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    source.invalidatePlaybackWindows();
    await expect(pending).rejects.toBeInstanceOf(PlaybackError);
    release();
  });

  it('keeps the 256 MiB cap off the Range path', () => {
    expect(MAX_BOUNDED_WHOLE_FILE_BYTES).toBe(256 * 1024 * 1024);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { WasmCoreDecoder } from '../audio/core/CoreDecoder';
import { HttpRangeSource } from '../audio/source/HttpRangeSource';
import { parseRangeRequestHeader } from '../audio/source/types';
import type { AudioStreamingDecoder, WasmRangeHost } from '@nnpm/audio-wasm';

function wavHeader(): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  return bytes;
}

function fakeStreaming(host: WasmRangeHost): AudioStreamingDecoder {
  let position = 44;
  return {
    channels: 2,
    sampleRate: 44_100,
    durationSeconds: 12,
    bytePosition: () => position,
    decodeChunk: (maxFrames) => {
      const hit = host.readSync(position, 64);
      if (!(hit instanceof Uint8Array)) throw hit;
      return new Float32Array(Math.max(1, maxFrames) * 2);
    },
    seekMs: (targetMs) => {
      position = Math.floor((targetMs / 12_000) * 1_000_000_000);
      const hit = host.readSync(position, 64);
      if (!(hit instanceof Uint8Array)) throw hit;
    },
    close: () => undefined,
  };
}

describe('WasmCoreDecoder Range I/O', () => {
  it('opens FLAC/PCM through Range reads instead of arrayBuffer() of the whole object', async () => {
    const advertised = 1024 * 1024 * 1024;
    const store = wavHeader();
    const requests: string[] = [];
    const fetchImpl: typeof fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
      const range = headers.get('Range');
      requests.push(range ?? '');
      const parsed = parseRangeRequestHeader(range);
      const start = parsed?.start ?? 0;
      const end = Math.min(
        advertised - 1,
        parsed && Number.isFinite(parsed.end) ? parsed.end : start + 64 * 1024 - 1,
      );
      const body = new Uint8Array(Math.max(0, end - start + 1));
      if (start === 0) body.set(store.subarray(0, Math.min(store.length, body.length)));
      return new Response(new Blob([new Uint8Array(body)]), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${advertised}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }) as typeof fetch;

    const box: { host: WasmRangeHost | null } = { host: null };
    const decoder = new WasmCoreDecoder({
      createSource: ({ urlProvider, signal }) => new HttpRangeSource({ urlProvider, signal, fetchImpl }),
      initAudioCore: async () => true,
      openStreamingSource: (host) => {
        box.host = host;
        return fakeStreaming(host);
      },
    });

    await decoder.open('https://storage.example.test/album.flac?sig=1');
    const format = decoder.decodedFormat();
    expect(format?.sampleRate).toBe(44_100);
    expect(box.host?.size).toBe(advertised);
    expect(requests.every(range => range.startsWith('bytes='))).toBe(true);
    expect(requests.some(range => range === `bytes=0-${advertised - 1}`)).toBe(false);

    decoder.prepareSeek();
    const chunk = await decoder.decodeWindow(9.6, 0.2, 2, 44_100);
    expect(chunk.frames.length).toBeGreaterThan(0);
    const parsed = requests.map(range => parseRangeRequestHeader(range));
    expect(parsed.some(range => range && range.start > advertised * 0.5)).toBe(true);

    await decoder.close();
  });
});

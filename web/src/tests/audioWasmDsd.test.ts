import { describe, expect, it, vi } from 'vitest';
import {
  createDsdPcmStream,
  createMinimalDsf,
  deinterleaveDsfPlanar,
  DsdDecodeError,
  dsdBytesToPcm,
  parseDsdHeader,
} from '@nnpm/audio-wasm';
import { DsdPlaybackSession } from '../audio/dsd/DsdPlaybackSession';

describe('audio-wasm DSF decoder', () => {
  it('parses a minimal DSF header and decodes PCM without loading the whole file into a second buffer', () => {
    const bytes = createMinimalDsf({ sampleCount: 64, blockSize: 8, channels: 2 });
    const header = parseDsdHeader(bytes, bytes.length);
    expect(header.container).toBe('dsf');
    expect(header.dsdRate).toBe(64);
    expect(header.encoding).toBe('raw');
    expect(header.outputSampleRate).toBe(176_400);
    const interleaved = deinterleaveDsfPlanar(
      bytes.subarray(header.dataOffset),
      header.channels,
      header.blockSize,
    );
    const pcm = dsdBytesToPcm(interleaved, header.channels, header.lsbFirst, header.dsdSampleRate, {
      allowJsFallback: true,
    });
    expect(pcm.length).toBeGreaterThan(0);
  });

  it('deinterleaves DSF planar blocks before PCM', () => {
    const physical = new Uint8Array(16);
    physical.fill(0xff, 0, 8);
    const interleaved = deinterleaveDsfPlanar(physical, 2, 8, 0, 8);
    expect(Array.from(interleaved)).toEqual([
      0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0,
    ]);
    const pcm = dsdBytesToPcm(interleaved, 2, false, 2_822_400, { allowJsFallback: true });
    expect(pcm.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < pcm.length; i += 2) {
      expect(pcm[i]).toBeGreaterThan(0.3);
      expect(pcm[i + 1]).toBeLessThan(-0.3);
    }
  });

  it('keeps byte-interleaved stereo channels separate', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i += 2) bytes[i] = 0xff;
    const pcm = dsdBytesToPcm(bytes, 2, false, 2_822_400, { allowJsFallback: true });
    expect(pcm.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < pcm.length; i += 2) {
      expect(pcm[i]).toBeGreaterThan(0.3);
      expect(pcm[i + 1]).toBeLessThan(-0.3);
    }
  });

  it('uses FRTE for DST DFF duration instead of compressed size', () => {
    function chunk(id: string, payload: Uint8Array): Uint8Array {
      const pad = payload.length % 2;
      const out = new Uint8Array(12 + payload.length + pad);
      const view = new DataView(out.buffer);
      for (let i = 0; i < 4; i += 1) out[i] = id.charCodeAt(i);
      view.setBigUint64(4, BigInt(payload.length), false);
      out.set(payload, 12);
      return out;
    }
    const frte = new Uint8Array(6);
    new DataView(frte.buffer).setUint32(0, 1);
    frte[4] = 0;
    frte[5] = 75;
    const dst = chunk('DST ', new Uint8Array([
      ...chunk('FRTE', frte),
      ...chunk('DSTF', new Uint8Array([0, 0, 0, 0])),
    ]));
    const prop = chunk('PROP', new Uint8Array([
      0x53, 0x4e, 0x44, 0x20,
      ...chunk('FS  ', new Uint8Array([0x00, 0x2b, 0x11, 0x00])),
      ...chunk('CHNL', new Uint8Array([0, 2])),
      ...chunk('CMPR', new Uint8Array([0x44, 0x53, 0x54, 0x20])),
    ]));
    const inner = new Uint8Array([...prop, ...dst]);
    const bytes = new Uint8Array(16 + inner.length);
    bytes.set([0x46, 0x52, 0x4d, 0x38], 0);
    new DataView(bytes.buffer).setBigUint64(4, BigInt(4 + inner.length));
    bytes.set([0x44, 0x53, 0x44, 0x20], 12);
    bytes.set(inner, 16);
    const header = parseDsdHeader(bytes, bytes.length);
    expect(header.encoding).toBe('dst');
    expect(header.sampleCount).toBe(Math.floor(2_822_400 / 75));
    expect(header.durationMs).toBe(13);
  });

  it('parses DST-compressed DFF headers without treating DST64 as unsupported', () => {
    const bytes = new Uint8Array(40);
    bytes.set([0x46, 0x52, 0x4d, 0x38], 0);
    bytes.set([0x44, 0x53, 0x44, 0x20], 12);
    bytes.set([0x44, 0x53, 0x54, 0x20], 16);
    const header = parseDsdHeader(bytes, bytes.length);
    expect(header.encoding).toBe('dst');
    expect(header.dstStatus).toBe('stable');
  });

  it('refuses the JS FIR fallback when WASM is missing', () => {
    const bytes = new Uint8Array(32);
    expect(() => dsdBytesToPcm(bytes, 2, false)).toThrow(DsdDecodeError);
    expect(() => dsdBytesToPcm(bytes, 2, false)).toThrow(/WASM FIR is required/);
    expect(() => createDsdPcmStream(2, false)).toThrow(/WASM FIR is required/);
  });

  it('aborts an in-flight range fetch on track change', async () => {
    const controller = new AbortController();
    let sawFetch: () => void = () => undefined;
    const fetched = new Promise<void>((resolve) => {
      sawFetch = resolve;
    });
    vi.stubGlobal('fetch', ((_input: RequestInfo | URL, init?: RequestInit) => {
      sawFetch();
      return new Promise((_resolve, reject) => {
        const fail = () => {
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        };
        if (init?.signal?.aborted) {
          fail();
          return;
        }
        init?.signal?.addEventListener('abort', fail, { once: true });
      });
    }) as typeof fetch);

    const session = new DsdPlaybackSession({
      onEnded: () => undefined,
      onError: () => undefined,
      onPosition: () => undefined,
    });
    const play = session.play('https://storage.example.test/track.dsf', 0, controller.signal);
    await fetched;
    controller.abort();
    await expect(play).rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });
});

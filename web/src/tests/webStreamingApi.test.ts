import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudApiClient } from '../api/client';
import { WebStreamingApi } from '../platform/streaming/WebStreamingApi';
import { jsonResponse } from './support/auth';

const STREAM = {
  url: 'https://storage.example.test/object/lanterns.wav?sig=abc',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  asset: {
    codec: 'pcm',
    container: 'wav',
    mime_type: 'audio/wav',
    sample_rate_hz: 44_100,
    bit_depth: 16,
    channels: 2,
    bitrate_kbps: 1411,
    lossless: true,
  },
};

function request(quality: 'auto' | 'high' | 'lossless' | 'max' = 'auto') {
  return {
    quality,
    supportedFormats: [],
  };
}

describe('WebStreamingApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends Bearer, quality, and empty supported formats like desktop', async () => {
    const captured: RequestInit[] = [];
    const client = new CloudApiClient({
      baseUrl: 'https://api.example.test',
      getAccessToken: () => 'access-token',
      fetcher: (async (_input, init) => {
        captured.push(init ?? {});
        return jsonResponse(STREAM);
      }) as typeof fetch,
    });
    const api = new WebStreamingApi(client);
    const descriptor = await api.createStream('track-1', request('lossless'));

    expect(descriptor.url).toBe(STREAM.url);
    expect(Date.parse(descriptor.expiresAt)).toBeGreaterThan(Date.now() - 1000);
    expect(descriptor.asset.mimeType).toBe('audio/wav');
    expect(new Headers(captured[0]?.headers).get('Authorization')).toBe('Bearer access-token');
    expect(captured[0]?.body).toBe(JSON.stringify({
      quality: 'lossless',
      supported_formats: [],
    }));
  });

  it('validates expires_at and rejects incomplete payloads', async () => {
    const client = new CloudApiClient({
      baseUrl: '/api',
      fetcher: (async () => jsonResponse({
        url: STREAM.url,
        expires_at: 'not-a-date',
        asset: STREAM.asset,
      })) as typeof fetch,
    });
    await expect(new WebStreamingApi(client).createStream('track-1', request()))
      .rejects.toThrow(/expires_at/);
  });

  it('forwards AbortSignal and does not persist or log the signed URL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const controller = new AbortController();
    controller.abort();
    const client = new CloudApiClient({
      baseUrl: '/api',
      fetcher: (async () => jsonResponse(STREAM)) as typeof fetch,
    });

    await expect(new WebStreamingApi(client).createStream('track-1', request(), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect([...log.mock.calls, ...info.mock.calls, ...debug.mock.calls].flat().join(' '))
      .not.toContain(STREAM.url);
  });

  it('uses the existing 401 refresh then retries', async () => {
    let token: string | null = 'expired';
    const paths: string[] = [];
    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => token,
      onUnauthorized: async () => {
        token = 'fresh-token';
        return true;
      },
      fetcher: (async (input, init) => {
        paths.push(String(input));
        const auth = new Headers(init?.headers).get('Authorization');
        if (auth === 'Bearer expired') {
          return jsonResponse({ code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired.' }, 401);
        }
        return jsonResponse(STREAM);
      }) as typeof fetch,
    });

    const descriptor = await new WebStreamingApi(client).createStream('track-1', request());
    expect(descriptor.asset.codec).toBe('pcm');
    expect(paths.filter(path => path.endsWith('/v1/tracks/track-1/stream'))).toHaveLength(2);
  });
});

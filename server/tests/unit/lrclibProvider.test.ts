import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../src/config/env.js';
import { ErrorCodes } from '../../src/errors/appError.js';
import { LrclibProvider } from '../../src/lyrics/lrclibProvider.js';

describe('LrclibProvider', () => {
  it('searches the configured origin and ranks a synchronized track-language hit', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      expect(url.startsWith('https://lyrics.example.test/api/search')).toBe(true);
      expect(url).toContain('track_name=');
      expect(url).toContain('artist_name=');
      expect(url).not.toContain('C%3A%5C');
      return new Response(JSON.stringify([
        {
          id: 1,
          trackName: '고민보다 Go',
          artistName: 'BTS',
          albumName: "LOVE YOURSELF 承 'Her'",
          duration: 235,
          instrumental: false,
          syncedLyrics: null,
          plainLyrics: '하루아침에 전부 탕진 달려 달려',
        },
        {
          id: 2,
          trackName: '고민보다 Go',
          artistName: 'BTS',
          albumName: "LOVE YOURSELF 承 'Her'",
          duration: 235,
          instrumental: false,
          syncedLyrics: '[00:01.00]하루아침에 전부 탕진 달려 달려',
          plainLyrics: '하루아침에 전부 탕진 달려 달려',
        },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const provider = new LrclibProvider(
      testConfig({ lyricsProviderUrl: 'https://lyrics.example.test' }),
      fetchImpl,
    );
    const result = await provider.resolve({
      title: '고민보다 Go',
      artist: 'BTS',
      album: "LOVE YOURSELF 承 'Her'",
      durationSeconds: 235,
    });
    expect(result?.source).toBe('lrclib');
    expect(result?.syncedLrc).toContain('하루아침에');
  });

  it('returns null on 404 and throws on timeout without treating it as not-found', async () => {
    const notFound = new LrclibProvider(testConfig(), async () => new Response('missing', { status: 404 }));
    expect(await notFound.resolve({
      title: 'x', artist: 'y', album: 'z', durationSeconds: 10,
    })).toBeNull();

    const timedOut = new LrclibProvider(testConfig(), async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    });
    await expect(timedOut.resolve({
      title: 'x', artist: 'y', album: 'z', durationSeconds: 10,
    })).rejects.toMatchObject({ code: ErrorCodes.LYRICS_PROVIDER_ERROR, statusCode: 502 });
  });

  it('returns an instrumental search hit instead of not-found', async () => {
    const provider = new LrclibProvider(testConfig(), async () => new Response(JSON.stringify([{
      id: 9,
      trackName: 'Interlude',
      artistName: 'Aurora Circuit',
      albumName: 'Glass Harbor',
      duration: 92,
      instrumental: true,
      syncedLyrics: null,
      plainLyrics: null,
    }]), { status: 200 }));

    const result = await provider.resolve({
      title: 'Interlude',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
      durationSeconds: 92,
    });
    expect(result).toMatchObject({ instrumental: true, source: 'lrclib' });
  });
});

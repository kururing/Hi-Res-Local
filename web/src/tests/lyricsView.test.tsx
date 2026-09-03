import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './support/localStorage';
import { remoteLyricsCacheKey, resolveLyricsForTrack } from '../components/views/lyricsLookup';
import type { TrackLyrics } from '../platform/contracts';
import type { LyricData } from '../types/lyrics';
import type { Track } from '../types/library';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-local',
    title: 'Local Title',
    artist: 'Local Artist',
    album: 'Local Album',
    duration: 180,
    path: '',
    date_added: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

const localLyrics: TrackLyrics = {
  is_synced: true,
  lines: [{ timestamp: 1, text: 'Local line' }],
  plain_text: 'Local line',
  source: 'local',
};

const remoteLyrics: TrackLyrics = {
  is_synced: true,
  lines: [{ timestamp: 2, text: 'Remote line' }],
  plain_text: 'Remote line',
  source: 'lrclib',
};

const passthroughHydrate = async (_trackId: string, lyrics: LyricData): Promise<LyricData> => lyrics;

function createLyricsApi(overrides: {
  getTrackLyrics?: ReturnType<typeof vi.fn>;
  fetchRemoteLyrics?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getTrackLyrics: vi.fn().mockResolvedValue(null),
    fetchRemoteLyrics: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('LyricsView lyrics loading', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shares the remote lyrics cache between duplicate files of the same recording', () => {
    const first = sampleTrack({ id: 'duplicate-a', duration: 177.2 });
    const second = sampleTrack({ id: 'duplicate-b', duration: 177.4 });

    expect(remoteLyricsCacheKey(first)).toBe(remoteLyricsCacheKey(second));
  });

  it('keeps different recordings in separate remote lyrics caches', () => {
    const studio = sampleTrack({ id: 'studio', duration: 177 });
    const live = sampleTrack({ id: 'live', album: 'Live Edition', duration: 205 });

    expect(remoteLyricsCacheKey(studio)).not.toBe(remoteLyricsCacheKey(live));
  });

  it('keeps synchronized local lyrics when remote lyrics are unavailable', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue(localLyrics),
    });

    const result = await resolveLyricsForTrack(
      sampleTrack({ lyrics: '[00:01.00]Embedded' }),
      lyricsApi,
      () => true,
      passthroughHydrate
    );

    expect(result?.lines[0]?.text).toBe('Local line');
    expect(lyricsApi.getTrackLyrics).toHaveBeenCalledWith('track-local');
    expect(lyricsApi.fetchRemoteLyrics).toHaveBeenCalled();
  });

  it('prefers stored original-language synced lyrics over a remote translation', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue({
        is_synced: true,
        lines: [{ timestamp: 1, text: '하루아침에 전부 탕진 달려 달려' }],
        plain_text: '하루아침에 전부 탕진 달려 달려',
        source: 'local',
      }),
      fetchRemoteLyrics: vi.fn().mockResolvedValue({
        is_synced: true,
        lines: [{ timestamp: 1, text: '全て無くすまで まだまだ 走り稼ぐだけ' }],
        plain_text: '全て無くすまで まだまだ 走り稼ぐだけ',
        source: 'lrclib',
      }),
    });

    const result = await resolveLyricsForTrack(
      sampleTrack({
        title: '고민보다 Go',
        artist: 'BTS',
        album: "LOVE YOURSELF 承 'Her'",
        genre: 'K-Pop',
      }),
      lyricsApi,
      () => true,
      passthroughHydrate
    );

    expect(result?.source).toBe('local');
    expect(result?.lines[0]?.text).toContain('하루아침에');
  });

  it('prefers synchronized remote lyrics over synchronized local lyrics', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue(localLyrics),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(remoteLyrics),
    });

    const result = await resolveLyricsForTrack(
      sampleTrack({ lyrics: '[00:01.00]Embedded synced line' }),
      lyricsApi,
      () => true,
      passthroughHydrate
    );

    expect(result?.source).toBe('lrclib');
    expect(result?.lines[0]?.text).toBe('Remote line');
  });

  it('falls back to remote lyrics only when stored and embedded lyrics are missing', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue(null),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(remoteLyrics),
    });
    const track = sampleTrack({ id: 'track-remote', lyrics: null });

    const result = await resolveLyricsForTrack(track, lyricsApi, () => true, passthroughHydrate);

    expect(result?.source).toBe('lrclib');
    expect(result?.lines[0]?.text).toBe('Remote line');
    expect(lyricsApi.fetchRemoteLyrics).toHaveBeenCalledWith({
      trackId: 'track-remote',
      title: 'Local Title',
      artist: 'Local Artist',
      album: 'Local Album',
      durationSeconds: 180,
    });
  });

  it('prefers embedded timestamped lyrics over stored plain lyrics', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue({
        is_synced: false,
        lines: [],
        plain_text: 'Stored plain lyrics',
        source: 'local',
      }),
    });

    const result = await resolveLyricsForTrack(
      sampleTrack({ lyrics: '[00:01.00]Embedded synced line' }),
      lyricsApi,
      () => true,
      passthroughHydrate
    );

    expect(result?.is_synced).toBe(true);
    expect(result?.lines[0]?.text).toBe('Embedded synced line');
    expect(lyricsApi.fetchRemoteLyrics).toHaveBeenCalled();
  });

  it('continues to remote lookup when only plain lyrics are available', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue({
        is_synced: false,
        lines: [],
        plain_text: 'Stored plain lyrics',
        source: 'local',
      }),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(remoteLyrics),
    });

    const result = await resolveLyricsForTrack(
      sampleTrack({ lyrics: 'Embedded plain lyrics' }),
      lyricsApi,
      () => true,
      passthroughHydrate
    );

    expect(result?.source).toBe('lrclib');
    expect(result?.lines[0]?.text).toBe('Remote line');
  });

  it('refreshes a plain remote cache to find synchronized lyrics', async () => {
    const track = sampleTrack({ id: 'track-cached-plain', lyrics: null });
    localStorage.setItem(remoteLyricsCacheKey(track), JSON.stringify({
      is_synced: false,
      lines: [],
      plain_text: 'Cached plain lyrics',
      source: 'lrclib',
    }));
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue(localLyrics),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(remoteLyrics),
    });

    const result = await resolveLyricsForTrack(track, lyricsApi, () => true, passthroughHydrate);

    expect(lyricsApi.fetchRemoteLyrics).toHaveBeenCalled();
    expect(result?.lines[0]?.text).toBe('Remote line');
  });

  it('keeps stored plain lyrics as fallback when no timestamped lyrics exist', async () => {
    const storedPlain: TrackLyrics = {
      is_synced: false,
      lines: [],
      plain_text: 'Stored plain lyrics',
      source: 'local',
    };
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockResolvedValue(storedPlain),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(null),
    });

    const result = await resolveLyricsForTrack(
      sampleTrack({ lyrics: null }),
      lyricsApi,
      () => true,
      passthroughHydrate
    );

    expect(result).toMatchObject({ plain_text: 'Stored plain lyrics', source: 'local' });
  });

  it('does not clear local lyrics when remote resolve fails', async () => {
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      fetchRemoteLyrics: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const track = sampleTrack({
      lyrics: '[00:01.00]Keep this line',
    });

    const result = await resolveLyricsForTrack(track, lyricsApi, () => true, passthroughHydrate);

    expect(result?.lines[0]?.text).toBe('Keep this line');
    expect(lyricsApi.fetchRemoteLyrics).toHaveBeenCalled();
  });

  it('ignores a stale result after the displayed track changes', async () => {
    const first = deferred<TrackLyrics | null>();
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({
          is_synced: true,
          lines: [{ timestamp: 1, text: 'Track B' }],
          plain_text: 'Track B',
          source: 'local',
        }),
    });

    let currentId = 'track-a';
    const pendingA = resolveLyricsForTrack(
      sampleTrack({ id: 'track-a' }),
      lyricsApi,
      () => currentId === 'track-a',
      passthroughHydrate
    );

    currentId = 'track-b';
    const pendingB = resolveLyricsForTrack(
      sampleTrack({ id: 'track-b' }),
      lyricsApi,
      () => currentId === 'track-b',
      passthroughHydrate
    );

    first.resolve(localLyrics);
    await expect(pendingA).resolves.toBeNull();
    await expect(pendingB).resolves.toMatchObject({ lines: [{ text: 'Track B' }] });
  });

  it('does not apply lyrics after unmount while a request is pending', async () => {
    const pending = deferred<TrackLyrics | null>();
    const lyricsApi = createLyricsApi({
      getTrackLyrics: vi.fn().mockReturnValue(pending.promise),
    });

    let mounted = true;
    const resultPromise = resolveLyricsForTrack(
      sampleTrack(),
      lyricsApi,
      () => mounted,
      passthroughHydrate
    );

    mounted = false;
    pending.resolve(localLyrics);
    await expect(resultPromise).resolves.toBeNull();
  });

  it('does not import IpcService and loads lyrics through the platform API', () => {
    const view = source('../components/views/LyricsView.tsx');
    const lookup = source('../components/views/lyricsLookup.ts');
    const mockLyrics = source('../platform/mock/MockLyricsApi.ts');
    const gateway = source('../platform/mock/MockCommandGateway.ts');
    const ipc = source('../services/ipc.ts');

    expect(view).not.toMatch(/IpcService/);
    expect(view).toMatch(/usePlatform\(\)/);
    expect(view).toMatch(/resolveLyricsForTrack/);
    expect(lookup).toMatch(/lyricsApi\.getTrackLyrics/);
    expect(lookup).toMatch(/lyricsApi\.fetchRemoteLyrics/);
    expect(mockLyrics).not.toMatch(/IpcService/);
    expect(gateway).not.toMatch(/get_track_lyrics|fetch_lrclib_lyrics/);
    expect(ipc).not.toMatch(/get_track_lyrics|fetch_lrclib_lyrics|parseLrc/);
  });
});

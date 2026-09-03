import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CloudApiError } from '../api/client';
import type { CloudApiClient } from '../api/client';
import type { PlatformCommandGateway } from '../platform/contracts';
import { TauriLyricsApi } from '../platform/lyrics/IpcLyricsApi';
import { MockLyricsApi } from '../platform/mock/MockLyricsApi';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockRuntime } from '../platform/mock/MockRuntime';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebLyricsApi } from '../platform/web/WebLyricsApi';
import { HybridLyricsApi } from '../platform/hybrid/HybridLyricsApi';
import type { TrackLyrics } from '../platform/contracts';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function createCloudClient(request: CloudApiClient['request']): CloudApiClient {
  return { request } as CloudApiClient;
}

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const remoteRequest = {
  trackId: 'track-1',
  title: 'Light',
  artist: 'Wanna One',
  album: '1÷x=1',
  durationSeconds: 183,
};

describe('TauriLyricsApi', () => {
  it('invokes get_track_lyrics and normalizes timestamp_ms and source', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriLyricsApi(commands);

    invoke.mockResolvedValueOnce({
      is_synced: true,
      lines: [{ timestamp_ms: 1500, text: 'First line' }],
      plain_text: 'First line',
      source: 'LrcFile',
    });

    const lyrics = await api.getTrackLyrics('track-1');
    expect(invoke).toHaveBeenLastCalledWith('get_track_lyrics', { trackId: 'track-1' });
    expect(lyrics?.lines[0]?.timestamp).toBe(1.5);
    expect(lyrics?.source).toBe('local');
    expect(lyrics?.instrumental).toBeUndefined();
  });

  it('invokes fetch_lrclib_lyrics with trackId only and marks instrumental payloads', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriLyricsApi(commands);

    invoke.mockResolvedValueOnce({
      is_synced: false,
      lines: [],
      plain_text: '[Instrumental]',
      source: 'Lrclib',
    });

    const lyrics = await api.fetchRemoteLyrics(remoteRequest);
    expect(invoke).toHaveBeenLastCalledWith('fetch_lrclib_lyrics', { trackId: 'track-1' });
    expect(JSON.stringify(invoke.mock.calls[0]?.[1])).not.toMatch(/duration|path|cover_art/);
    expect(lyrics?.source).toBe('lrclib');
    expect(lyrics?.instrumental).toBe(true);
    expect(lyrics?.plain_text).toBe('[Instrumental]');
  });

  it('returns null when the backend has no lyrics', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriLyricsApi(commands);
    invoke.mockResolvedValueOnce(null);
    await expect(api.getTrackLyrics('missing')).resolves.toBeNull();
  });

  it('normalizes string IPC errors into Error', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriLyricsApi(commands);
    invoke.mockRejectedValueOnce('track not found');
    await expect(api.getTrackLyrics('track-1')).rejects.toThrow('track not found');
  });
});

describe('MockLyricsApi', () => {
  it('reads local lyrics for the matching track from the shared store', async () => {
    const runtime = new MockRuntime({ persist: false });
    const tracks = await runtime.library.getAllTracks();
    const withLyrics = tracks.find(track => track.lyrics);
    const withoutLyrics = tracks.find(track => !track.lyrics);
    expect(withLyrics).toBeDefined();
    expect(withoutLyrics).toBeDefined();

    const lyrics = await runtime.lyrics.getTrackLyrics(withLyrics!.id);
    expect(lyrics).not.toBeNull();
    expect(lyrics?.lines.length).toBeGreaterThan(0);
    expect(lyrics?.lines[0]?.text).toContain('Nắng Ấm Xa Dần');

    await expect(runtime.lyrics.getTrackLyrics(withoutLyrics!.id)).resolves.toBeNull();
    await expect(runtime.lyrics.getTrackLyrics('missing-track')).resolves.toBeNull();
  });

  it('returns a deterministic null remote result without touching playback', async () => {
    const runtime = new MockRuntime({ persist: false });
    const request = {
      trackId: 'track-5',
      title: 'Hotel California (Live on MTV 1994)',
      artist: 'Eagles',
      album: 'Hell Freezes Over',
      durationSeconds: 432,
    };

    await expect(runtime.lyrics.fetchRemoteLyrics(request)).resolves.toBeNull();
    await expect(runtime.lyrics.fetchRemoteLyrics(request)).resolves.toBeNull();
    expect(await runtime.audioConfiguration.getOutputDevices()).toHaveLength(3);
  });

  it('restores fixture lyrics after runtime reset', async () => {
    const runtime = new MockRuntime({ persist: false });
    const before = await runtime.lyrics.getTrackLyrics('track-13');
    expect(before?.romanized?.lines.length).toBeGreaterThan(0);

    runtime.reset();
    const after = await runtime.lyrics.getTrackLyrics('track-13');
    expect(after?.romanized?.lines[0]?.text).toBe(before?.romanized?.lines[0]?.text);
    await expect(runtime.lyrics.fetchRemoteLyrics({
      ...remoteRequest,
      trackId: 'track-13',
    })).resolves.toBeNull();
  });
});

describe('WebLyricsApi', () => {
  it('loads stored lyrics from the cloud track endpoint', async () => {
    const request = vi.fn();
    const api = new WebLyricsApi(createCloudClient(request));
    const payload: TrackLyrics = {
      is_synced: true,
      lines: [{ timestamp: 2.5, text: 'Cloud line' }],
      plain_text: 'Cloud line',
      source: 'local',
    };

    request.mockResolvedValueOnce(payload);
    await expect(api.getTrackLyrics('cloud-track-id')).resolves.toMatchObject({
      lines: [{ timestamp: 2.5, text: 'Cloud line' }],
    });
    expect(request).toHaveBeenLastCalledWith('/v1/tracks/cloud-track-id/lyrics');
  });

  it('resolves remote lyrics without sending filesystem paths', async () => {
    const request = vi.fn().mockResolvedValue({
      is_synced: true,
      lines: [{ timestamp_seconds: 1.25, text: 'Resolved' }],
      plain_text: 'Resolved',
      source: 'lrclib',
    });
    const api = new WebLyricsApi(createCloudClient(request));

    const lyrics = await api.fetchRemoteLyrics({
      trackId: 'cloud-track-id',
      title: 'Track title',
      artist: 'Artist',
      album: 'Album',
      durationSeconds: 240,
    });

    expect(lyrics?.lines[0]?.timestamp).toBe(1.25);
    expect(lyrics?.source).toBe('lrclib');
    expect(request).toHaveBeenLastCalledWith('/v1/lyrics/resolve', {
      method: 'POST',
      body: {
        track_id: 'cloud-track-id',
        title: 'Track title',
        artist: 'Artist',
        album: 'Album',
        duration_seconds: 240,
      },
    });
    expect(JSON.stringify(request.mock.calls[0]?.[1])).not.toMatch(/path|cover_art/);
  });

  it('treats 404 and empty not-found payloads as null', async () => {
    const request = vi.fn();
    const api = new WebLyricsApi(createCloudClient(request));

    request.mockRejectedValueOnce(new CloudApiError('Not found', 404));
    await expect(api.getTrackLyrics('missing')).resolves.toBeNull();

    request.mockResolvedValueOnce({ not_found: true });
    await expect(api.fetchRemoteLyrics(remoteRequest)).resolves.toBeNull();

    request.mockResolvedValueOnce({ lyrics: null });
    await expect(api.getTrackLyrics('missing')).resolves.toBeNull();
  });

  it('rejects invalid lyrics payloads instead of inventing lyrics', async () => {
    const request = vi.fn().mockResolvedValue({ unexpected: true });
    const api = new WebLyricsApi(createCloudClient(request));
    await expect(api.getTrackLyrics('track-1')).rejects.toThrow(/missing a lyrics payload/);
  });

  it('keeps auth, network, and server error semantics', async () => {
    const request = vi.fn();
    const api = new WebLyricsApi(createCloudClient(request));

    request.mockRejectedValueOnce(new CloudApiError('Unauthorized', 401));
    await expect(api.getTrackLyrics('track-1')).rejects.toMatchObject({
      name: 'CloudApiError',
      status: 401,
    });

    request.mockRejectedValueOnce(new CloudApiError('Forbidden', 403));
    await expect(api.fetchRemoteLyrics(remoteRequest)).rejects.toMatchObject({ status: 403 });

    request.mockRejectedValueOnce(new CloudApiError('Upstream failed', 502));
    await expect(api.fetchRemoteLyrics(remoteRequest)).rejects.toMatchObject({ status: 502 });

    request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.getTrackLyrics('track-1')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('platform wiring', () => {
  it('exposes the matching lyrics adapter on each runtime', () => {
    expect(createTauriPlatform().lyrics).toBeInstanceOf(TauriLyricsApi);
    expect(createMockPlatform().lyrics).toBeInstanceOf(MockLyricsApi);
    expect(createWebPlatform('/api').lyrics).toBeInstanceOf(WebLyricsApi);
  });

  it('resolves signed-in desktop lyrics through the cloud API after local miss', () => {
    const platform = createTauriPlatform({
      cloud: createCloudClient(vi.fn()),
      isAuthenticated: () => true,
    });
    expect(platform.lyrics).toBeInstanceOf(HybridLyricsApi);
  });
});

describe('HybridLyricsApi', () => {
  it('upgrades a plain cloud cache with synchronized desktop lyrics', async () => {
    const plain = {
      is_synced: false,
      lines: [],
      plain_text: 'One',
      source: 'lrclib' as const,
    };
    const synced = {
      is_synced: true,
      lines: [{ timestamp: 0.83, text: 'One' }],
      source: 'lrclib' as const,
    };
    const local = {
      getTrackLyrics: vi.fn().mockResolvedValue(null),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(synced),
    };
    const cloud = {
      getTrackLyrics: vi.fn().mockResolvedValue(null),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(plain),
    };

    const api = new HybridLyricsApi(local, cloud, () => true);
    await expect(api.fetchRemoteLyrics(remoteRequest)).resolves.toEqual(synced);
    expect(local.fetchRemoteLyrics).toHaveBeenCalledWith(remoteRequest);
  });

  it('replaces a synced cloud translation with desktop original-language lyrics', async () => {
    const translated = {
      is_synced: true,
      lines: [{ timestamp: 1, text: 'I keep running through the night again' }],
      source: 'lrclib' as const,
    };
    const original = {
      is_synced: true,
      lines: [{ timestamp: 1, text: '하루아침에 전부 탕진 달려 달려' }],
      source: 'lrclib' as const,
    };
    const local = {
      getTrackLyrics: vi.fn().mockResolvedValue(null),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(original),
    };
    const cloud = {
      getTrackLyrics: vi.fn().mockResolvedValue(null),
      fetchRemoteLyrics: vi.fn().mockResolvedValue(translated),
    };

    const api = new HybridLyricsApi(local, cloud, () => true);
    await expect(api.fetchRemoteLyrics({
      trackId: 'track-1',
      title: '고민보다 Go',
      artist: 'BTS',
      album: "LOVE YOURSELF 承 'Her'",
      durationSeconds: 235,
      genre: 'K-Pop',
    })).resolves.toEqual(original);
    expect(local.fetchRemoteLyrics).toHaveBeenCalled();
  });
});

describe('lyrics architecture', () => {
  it('keeps lyrics commands out of the compatibility gateway and ipc.ts', () => {
    const gateway = source('../platform/mock/MockCommandGateway.ts');
    const ipc = source('../services/ipc.ts');
    expect(gateway).not.toMatch(/get_track_lyrics|fetch_lrclib_lyrics/);
    expect(ipc).not.toMatch(/get_track_lyrics|fetch_lrclib_lyrics|parseLrc/);
  });
});

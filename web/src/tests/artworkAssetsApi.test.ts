import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TauriArtworkAssetsApi } from '../platform/artwork/IpcArtworkAssetsApi';
import { MockArtworkAssetsApi } from '../platform/mock/MockArtworkAssetsApi';
import { ArtworkCacheError, type ArtworkAssetsApi, type PlatformCommandGateway } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { isArtworkImageDataUrl, WebArtworkAssetsApi } from '../platform/web/WebArtworkAssetsApi';
import { resolveTrackArtworkSource } from '../services/trackArtwork';
import type { Track } from '../types/library';

const { mockConvertFileSrc } = vi.hoisted(() => ({
  mockConvertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => mockConvertFileSrc(path),
}));

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Light',
    artist: 'Wanna One',
    album: '1÷x=1',
    duration: 183,
    path: '',
    date_added: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function createArtworkAssets(overrides: Partial<ArtworkAssetsApi> = {}): ArtworkAssetsApi {
  return {
    resolveDisplaySource: async source => source ?? null,
    getAppleMusicArtistArtwork: async () => null,
    cacheRemoteArtwork: async (_key, dataUrl) => dataUrl,
    clearRemoteArtworkCache: async () => undefined,
    ...overrides,
  };
}

describe('TauriArtworkAssetsApi', () => {
  it('resolves a local filesystem path to a webview display URL', async () => {
    const api = new TauriArtworkAssetsApi(createGateway().commands);
    const result = await api.resolveDisplaySource('C:/Users/bang/Music/cover.jpg');

    expect(mockConvertFileSrc).toHaveBeenCalledWith('C:/Users/bang/Music/cover.jpg');
    expect(result).toBe('asset://C:/Users/bang/Music/cover.jpg');
  });

  it('keeps web, data, and blob URLs unchanged', async () => {
    const api = new TauriArtworkAssetsApi(createGateway().commands);
    mockConvertFileSrc.mockClear();

    await expect(api.resolveDisplaySource('https://cdn.example.test/cover.jpg'))
      .resolves.toBe('https://cdn.example.test/cover.jpg');
    await expect(api.resolveDisplaySource(pngDataUrl)).resolves.toBe(pngDataUrl);
    await expect(api.resolveDisplaySource('blob:https://app.local/cover'))
      .resolves.toBe('blob:https://app.local/cover');
    expect(mockConvertFileSrc).not.toHaveBeenCalled();
  });

  it('caches through IPC and returns a webview asset URL, not a raw filesystem path', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriArtworkAssetsApi(commands);
    invoke.mockResolvedValueOnce('C:/Users/bang/AppData/cover.jpg');

    const result = await api.cacheRemoteArtwork('album:echo:right album', pngDataUrl);

    expect(invoke).toHaveBeenCalledWith('cache_image_data', {
      cacheKey: 'album:echo:right album',
      category: 'remote-artwork',
      dataUrl: pngDataUrl,
    });
    expect(mockConvertFileSrc).toHaveBeenCalledWith('C:/Users/bang/AppData/cover.jpg');
    expect(result).toBe('asset://C:/Users/bang/AppData/cover.jpg');
    expect(result).not.toMatch(/^[A-Za-z]:[\\/]/);
  });

  it('looks up Apple Music artwork and clears cache through typed IPC', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriArtworkAssetsApi(commands);
    invoke.mockResolvedValueOnce('https://images.example/artist-202.jpg');
    invoke.mockResolvedValueOnce(undefined);

    await expect(api.getAppleMusicArtistArtwork('vn', 202))
      .resolves.toBe('https://images.example/artist-202.jpg');
    await api.clearRemoteArtworkCache();

    expect(invoke).toHaveBeenNthCalledWith(1, 'get_apple_music_artist_artwork', {
      country: 'vn',
      artistId: 202,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'clear_image_cache', {
      category: 'remote-artwork',
    });
  });
});

describe('MockArtworkAssetsApi', () => {
  it('returns a usable image from the preview cache', async () => {
    const api = new MockArtworkAssetsApi();

    const result = await api.cacheRemoteArtwork('album:echo:right album', pngDataUrl);
    expect(result).toBe(pngDataUrl);
    expect(isArtworkImageDataUrl(result)).toBe(true);
  });

  it('keeps web URLs and does not resolve local filesystem paths', async () => {
    const api = new MockArtworkAssetsApi();
    await expect(api.resolveDisplaySource('https://cdn.example.test/cover.jpg'))
      .resolves.toBe('https://cdn.example.test/cover.jpg');
    await expect(api.resolveDisplaySource('C:/Users/bang/Music/cover.jpg')).resolves.toBeNull();
    await expect(api.getAppleMusicArtistArtwork('vn', 202)).resolves.toBeNull();
  });
});

describe('platform wiring', () => {
  it('exposes the matching artwork adapter on each runtime', () => {
    expect(createTauriPlatform().artworkAssets).toBeInstanceOf(TauriArtworkAssetsApi);
    expect(createMockPlatform().artworkAssets).toBeInstanceOf(MockArtworkAssetsApi);
    expect(createWebPlatform('/api').artworkAssets).toBeInstanceOf(WebArtworkAssetsApi);
  });
});

describe('WebArtworkAssetsApi', () => {
  it('keeps web, data, and blob URLs and returns null for filesystem paths', async () => {
    const api = new WebArtworkAssetsApi();

    await expect(api.resolveDisplaySource('https://cdn.example.test/cover.jpg'))
      .resolves.toBe('https://cdn.example.test/cover.jpg');
    await expect(api.resolveDisplaySource(pngDataUrl)).resolves.toBe(pngDataUrl);
    await expect(api.resolveDisplaySource('blob:https://app.local/cover'))
      .resolves.toBe('blob:https://app.local/cover');
    await expect(api.resolveDisplaySource('C:/Users/bang/Music/cover.jpg')).resolves.toBeNull();
    await expect(api.resolveDisplaySource('D:\\Music\\cover.jpg')).resolves.toBeNull();
    await expect(api.resolveDisplaySource('/Users/bang/Music/cover.jpg')).resolves.toBeNull();
    await expect(api.resolveDisplaySource('file:///Users/bang/Music/cover.jpg')).resolves.toBeNull();
    await expect(api.getAppleMusicArtistArtwork('vn', 202)).resolves.toBeNull();
  });

  it('does not import a cloud client or send local paths to the network', () => {
    expect(source('../platform/web/WebArtworkAssetsApi.ts')).not.toMatch(/CloudApiClient/);
    expect(source('../platform/web/WebArtworkAssetsApi.ts')).not.toMatch(/@tauri-apps/);
  });

  it('returns a usable data URL from cache and rejects invalid payloads', async () => {
    const api = new WebArtworkAssetsApi();
    await expect(api.cacheRemoteArtwork('album:echo:right album', pngDataUrl))
      .resolves.toBe(pngDataUrl);

    await expect(api.cacheRemoteArtwork('album:echo:right album', 'C:/Users/bang/Music/cover.jpg'))
      .rejects.toBeInstanceOf(ArtworkCacheError);
    await expect(api.cacheRemoteArtwork('album:echo:right album', 'https://cdn.example.test/cover.jpg'))
      .rejects.toThrow(/image data URLs/i);

    await expect(api.clearRemoteArtworkCache()).resolves.toBeUndefined();
  });
});

describe('resolveTrackArtworkSource', () => {
  it('uses the adapter for cover paths and falls back when resolve returns null', async () => {
    const artworkAssets = createArtworkAssets({
      resolveDisplaySource: async source => source?.startsWith('https') ? source ?? null : null,
    });

    await expect(resolveTrackArtworkSource(
      sampleTrack({ cover_art_path: 'https://cdn.example.test/cover.jpg' }),
      artworkAssets,
    )).resolves.toBe('https://cdn.example.test/cover.jpg');

    await expect(resolveTrackArtworkSource(
      sampleTrack({ cover_art_path: 'C:/cover.jpg' }),
      artworkAssets,
    )).resolves.toBeNull();
  });
});

describe('artwork display races', () => {
  it('does not apply a stale resolve after the track source changes', async () => {
    let resolveOld: ((value: string | null) => void) | undefined;
    const artworkAssets = createArtworkAssets({
      resolveDisplaySource: source => {
        if (source?.includes('old')) {
          return new Promise(resolve => {
            resolveOld = resolve;
          });
        }
        return Promise.resolve('https://cdn.example.test/new.jpg');
      },
    });

    let displayed: string | null = 'placeholder';
    let cancelled = false;
    void artworkAssets.resolveDisplaySource('C:/cache/old.jpg').then(resolved => {
      if (!cancelled) displayed = resolved;
    });

    cancelled = true;
    displayed = await resolveTrackArtworkSource(
      sampleTrack({ cover_art_path: 'https://cdn.example.test/new.jpg' }),
      artworkAssets,
    );
    resolveOld?.('asset://old');
    await Promise.resolve();

    expect(displayed).toBe('https://cdn.example.test/new.jpg');
  });
});

describe('artwork consumers', () => {
  it('no longer import IpcService, isTauri, convertFileSrc, or Tauri packages', () => {
    const files = [
      '../components/common/TrackArtwork.tsx',
      '../components/common/PlaylistArtwork.tsx',
      '../components/layout/ArtworkAdaptiveTheme.tsx',
      '../components/views/SettingsView.tsx',
      '../services/trackArtwork.ts',
      '../services/remoteArtwork.ts',
    ];
    for (const file of files) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/IpcService/);
      expect(contents, file).not.toMatch(/isTauri/);
      expect(contents, file).not.toMatch(/convertFileSrc/);
    }
    const migrated = [
      '../components/common/TrackArtwork.tsx',
      '../components/common/PlaylistArtwork.tsx',
      '../components/layout/ArtworkAdaptiveTheme.tsx',
      '../services/trackArtwork.ts',
      '../services/remoteArtwork.ts',
    ];
    for (const file of migrated) {
      expect(source(file), file).not.toMatch(/@tauri-apps/);
    }
  });
});

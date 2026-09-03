import { describe, expect, it, vi } from 'vitest';
import type { CloudApiClient } from '../api/client';
import type { PlatformCommandGateway } from '../platform/contracts';
import { PlatformUnsupportedError } from '../platform/contracts';
import { HybridLibraryApi } from '../platform/hybrid/HybridLibraryApi';
import { TauriLibraryApi } from '../platform/library/IpcLibraryApi';
import { MockLibraryApi } from '../platform/mock/MockLibraryApi';
import { MockRuntime } from '../platform/mock/MockRuntime';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { isLocalFilePath, WebLibraryApi } from '../platform/web/WebLibraryApi';
import type { Track } from '../types/library';
import type { LibraryRoot } from '../types/ipc';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

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

function sampleRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
  return {
    id: 'root-1',
    path: '',
    name: 'Library',
    is_active: true,
    created_at: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function createCloudClient(request: CloudApiClient['request']): CloudApiClient {
  return { request } as CloudApiClient;
}

describe('TauriLibraryApi', () => {
  it('invokes the matching IPC command and arguments', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriLibraryApi(commands);

    invoke.mockResolvedValueOnce([]);
    await api.getAllTracks();
    expect(invoke).toHaveBeenLastCalledWith('get_all_tracks');

    invoke.mockResolvedValueOnce({
      total_tracks: 0,
      total_artists: 0,
      total_albums: 0,
      total_duration_secs: 0,
    });
    await api.getStats();
    expect(invoke).toHaveBeenLastCalledWith('get_library_stats');

    invoke.mockResolvedValueOnce([]);
    await api.getRoots();
    expect(invoke).toHaveBeenLastCalledWith('get_library_roots');

    invoke.mockResolvedValueOnce('D:/Music');
    await api.pickFolder();
    expect(invoke).toHaveBeenLastCalledWith('open_folder_dialog');

    invoke.mockResolvedValueOnce(sampleRoot({ path: 'D:/Music/Hi-Res', name: 'Hi-Res' }));
    await api.addRoot('D:/Music/Hi-Res', 'Hi-Res');
    expect(invoke).toHaveBeenLastCalledWith('add_library_root', {
      path: 'D:/Music/Hi-Res',
      name: 'Hi-Res',
    });

    invoke.mockResolvedValueOnce(true);
    await api.removeRoot('D:/Music/Hi-Res');
    expect(invoke).toHaveBeenLastCalledWith('remove_library_root_by_path', {
      path: 'D:/Music/Hi-Res',
    });

    invoke.mockResolvedValueOnce([]);
    await api.scanDirectory('D:/Music/Hi-Res');
    expect(invoke).toHaveBeenLastCalledWith('scan_directory', { path: 'D:/Music/Hi-Res' });

    invoke.mockResolvedValueOnce(12);
    await api.scanLibrary();
    expect(invoke).toHaveBeenLastCalledWith('scan_library');

    invoke.mockResolvedValueOnce(undefined);
    await api.setDirectoryWatching(true);
    expect(invoke).toHaveBeenLastCalledWith('set_directory_watching', { enabled: true });
  });

  it('returns an unsubscribe function from library event subscriptions', async () => {
    const { listen, commands } = createGateway();
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    const api = new TauriLibraryApi(commands);
    const onProgress = vi.fn();

    const unsubscribe = await api.subscribeScanProgress(onProgress);

    expect(listen).toHaveBeenCalledWith('library://scan_progress', onProgress);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);

    await api.subscribeScanFinished(vi.fn());
    expect(listen).toHaveBeenCalledWith('library://scan_finished', expect.any(Function));
    await api.subscribeTrackUpdated(vi.fn());
    expect(listen).toHaveBeenCalledWith('library:track_updated', expect.any(Function));
    await api.subscribeTrackDeleted(vi.fn());
    expect(listen).toHaveBeenCalledWith('library:track_deleted', expect.any(Function));
  });
});

describe('MockLibraryApi', () => {
  it('lists fixture tracks, stats, and roots from the shared store', async () => {
    const runtime = new MockRuntime({ persist: false, scanStepDelayMs: 0 });
    const tracks = await runtime.library.getAllTracks();
    const stats = await runtime.library.getStats();

    expect(tracks.length).toBeGreaterThan(0);
    expect(stats.total_tracks).toBe(tracks.length);
    expect(await runtime.library.getRoots()).toEqual([]);
    expect(await runtime.library.pickFolder()).toBe('D:/Music/Hi-Res Collection');
  });

  it('adds and removes library roots and emits scan events', async () => {
    const runtime = new MockRuntime({ persist: false, scanStepDelayMs: 0 });
    const progress: Array<{ scanned_files: number; is_scanning: boolean }> = [];
    const finished: Array<{ total: number; success: boolean }> = [];
    await runtime.library.subscribeScanProgress(event => progress.push(event));
    await runtime.library.subscribeScanFinished(event => finished.push(event));

    const root = await runtime.library.addRoot('D:/Music/Hi-Res', 'Hi-Res');
    expect(root.path).toBe('D:/Music/Hi-Res');
    expect(await runtime.library.getRoots()).toHaveLength(1);
    expect(await runtime.library.removeRoot('D:/Music/Hi-Res')).toBe(true);
    expect(await runtime.library.getRoots()).toHaveLength(0);

    const scanned = await runtime.library.scanDirectory('D:/Music');
    expect(scanned.length).toBeGreaterThan(0);
    expect(progress).toHaveLength(12);
    expect(progress.at(-1)?.is_scanning).toBe(false);
    expect(finished).toEqual([{ total: 12, success: true }]);
  });
});

describe('platform wiring', () => {
  it('exposes the matching library adapter on each runtime', () => {
    expect(createTauriPlatform().library).toBeInstanceOf(TauriLibraryApi);
    expect(createMockPlatform().library).toBeInstanceOf(MockLibraryApi);
    expect(createWebPlatform('/api').library).toBeInstanceOf(WebLibraryApi);
  });

  it('wraps local IPC with the hybrid catalog when a cloud client is provided', () => {
    const request = vi.fn();
    const platform = createTauriPlatform({
      cloud: createCloudClient(request),
      isAuthenticated: () => true,
    });
    expect(platform.library).toBeInstanceOf(HybridLibraryApi);
    expect(platform.capabilities.remotePlayback).toBe(true);
    expect(platform.capabilities.adminCatalog).toBe(false);
  });
});

describe('HybridLibraryApi', () => {
  it('keeps local tracks when the cloud catalog is unreachable', async () => {
    const { invoke, commands } = createGateway();
    invoke.mockResolvedValueOnce([sampleTrack({ path: 'D:/Music/Light.flac' })]);
    const api = new HybridLibraryApi(
      new TauriLibraryApi(commands),
      new WebLibraryApi(createCloudClient(vi.fn().mockRejectedValue(new Error('offline')))),
      () => true,
    );
    const tracks = await api.getAllTracks();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.source).toBe('local');
    expect(tracks[0]?.path).toBe('D:/Music/Light.flac');
  });
});

describe('WebLibraryApi', () => {
  it('loads published catalog data from the cloud API', async () => {
    const request = vi.fn();
    const api = new WebLibraryApi(createCloudClient(request));
    const remoteTrack = sampleTrack({
      path: 'https://cdn.example.test/tracks/light.flac',
      cover_art_path: 'https://cdn.example.test/covers/light.jpg',
    });

    request.mockResolvedValueOnce([remoteTrack]);
    await expect(api.getAllTracks()).resolves.toEqual([remoteTrack]);
    expect(request).toHaveBeenLastCalledWith('/v1/catalog/tracks');

    request.mockResolvedValueOnce({
      total_tracks: 1,
      total_artists: 1,
      total_albums: 1,
      total_duration_secs: 183,
    });
    await expect(api.getStats()).resolves.toMatchObject({ total_tracks: 1 });
    expect(request).toHaveBeenLastCalledWith('/v1/catalog/stats');

    request.mockResolvedValueOnce([sampleRoot({ path: 'library-light' })]);
    await expect(api.getRoots()).resolves.toEqual([sampleRoot({ path: 'library-light' })]);
    expect(request).toHaveBeenLastCalledWith('/v1/library/roots');
  });

  it('rejects local folder picking and scanning without calling the cloud API', async () => {
    const request = vi.fn();
    const api = new WebLibraryApi(createCloudClient(request));

    await expect(api.pickFolder()).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.scanDirectory('D:/Music')).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.scanLibrary()).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.addRoot('D:/Music', 'Music')).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.removeRoot('D:/Music')).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.setDirectoryWatching(true)).rejects.toBeInstanceOf(PlatformUnsupportedError);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not expose local filesystem paths from cloud payloads', async () => {
    const request = vi.fn();
    const api = new WebLibraryApi(createCloudClient(request));

    request.mockResolvedValueOnce([
      sampleTrack({
        path: 'D:/Music/V-Pop/Light.flac',
        cover_art_path: 'C:/cache/light.jpg',
        artist_image_url: 'C:/cache/artist.jpg',
      }),
      sampleTrack({
        id: 'track-2',
        path: '/Users/bang/Music/Light.flac',
        cover_art_path: 'file:///Users/bang/Music/cover.jpg',
      }),
    ]);

    const tracks = await api.getAllTracks();
    const serialized = JSON.stringify(tracks);

    expect(tracks[0]?.path).toBe('');
    expect(tracks[0]?.cover_art_path).toBeNull();
    expect(tracks[0]?.artist_image_url).toBeNull();
    expect(tracks[1]?.path).toBe('');
    expect(tracks[1]?.cover_art_path).toBeNull();
    expect(serialized).not.toMatch(/D:\/Music/);
    expect(serialized).not.toMatch(/C:\/cache/);
    expect(serialized).not.toMatch(/\/Users\/bang/);
    expect(serialized).not.toMatch(/file:/);

    request.mockResolvedValueOnce([
      sampleRoot({ path: 'D:/Music/Hi-Res Collection' }),
    ]);
    const roots = await api.getRoots();
    expect(roots[0]?.path).toBe('');
    expect(JSON.stringify(roots)).not.toMatch(/D:\/Music/);
  });

  it('returns an unsubscribe function without opening a local scan subscription', async () => {
    const request = vi.fn();
    const api = new WebLibraryApi(createCloudClient(request));
    const unsubscribe = await api.subscribeScanProgress(() => undefined);

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('isLocalFilePath', () => {
  it('detects desktop filesystem locations and ignores cloud identifiers', () => {
    expect(isLocalFilePath('D:/Music/track.flac')).toBe(true);
    expect(isLocalFilePath('C:\\cache\\cover.jpg')).toBe(true);
    expect(isLocalFilePath('/home/bang/Music/track.flac')).toBe(true);
    expect(isLocalFilePath('https://cdn.example.test/track.flac')).toBe(false);
    expect(isLocalFilePath('library-light')).toBe(false);
  });
});

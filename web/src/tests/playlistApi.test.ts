import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import './support/localStorage';
import type { CloudApiClient } from '../api/client';
import type { PlatformCommandGateway } from '../platform/contracts';
import { PlatformUnsupportedError } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockPlaylistApi } from '../platform/mock/MockPlaylistApi';
import { TauriPlaylistApi } from '../platform/playlists/IpcPlaylistApi';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebPlaylistApi } from '../platform/web/WebPlaylistApi';
import { AccountBoundPlaylistApi } from '../platform/hybrid/AccountBoundApis';
import { Storage } from '../services/storage';
import type { BackendPlaylist, PlaylistDetails } from '../types/ipc';
import type { Track } from '../types/library';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function createCloudClient(request: CloudApiClient['request']): CloudApiClient {
  return { request } as CloudApiClient;
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

function samplePlaylist(overrides: Partial<BackendPlaylist> = {}): BackendPlaylist {
  return {
    id: 'pl-1',
    name: 'Evening Mix',
    description: 'Late night',
    is_smart: false,
    cover_art_path: null,
    track_count: 0,
    total_duration_ms: 0,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function sampleDetails(overrides: Partial<PlaylistDetails> = {}): PlaylistDetails {
  const playlist = overrides.playlist ?? samplePlaylist();
  return {
    playlist,
    tracks: overrides.tracks ?? [],
  };
}

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('TauriPlaylistApi', () => {
  it('invokes the matching IPC command and arguments', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriPlaylistApi(commands);
    const playlist = samplePlaylist();

    invoke.mockResolvedValueOnce([playlist]);
    await api.list();
    expect(invoke).toHaveBeenLastCalledWith('get_playlists');

    invoke.mockResolvedValueOnce(sampleDetails());
    await api.get('pl-1');
    expect(invoke).toHaveBeenLastCalledWith('get_playlist', { id: 'pl-1' });

    invoke.mockResolvedValueOnce(playlist);
    await api.create({ name: 'Evening Mix', description: 'Late night' });
    expect(invoke).toHaveBeenLastCalledWith('create_playlist', {
      input: { name: 'Evening Mix', description: 'Late night' },
    });

    invoke.mockResolvedValueOnce(playlist);
    await api.update({ id: 'pl-1', name: 'Night Mix', cover_art_path: 'D:/cache/cover.jpg' });
    expect(invoke).toHaveBeenLastCalledWith('update_playlist', {
      input: { id: 'pl-1', name: 'Night Mix', cover_art_path: 'D:/cache/cover.jpg' },
    });

    invoke.mockResolvedValueOnce(true);
    await api.delete('pl-1');
    expect(invoke).toHaveBeenLastCalledWith('delete_playlist', { id: 'pl-1' });
  });

  it('keeps add, remove, and reorder arguments in the original order', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriPlaylistApi(commands);
    const trackIds = ['track-2', 'track-1', 'track-3'];

    invoke.mockResolvedValueOnce(2);
    await api.addTracks('pl-1', trackIds);
    expect(invoke).toHaveBeenLastCalledWith('add_tracks_to_playlist', {
      playlistId: 'pl-1',
      trackIds,
    });

    invoke.mockResolvedValueOnce(1);
    await api.removeTracks('pl-1', ['track-2']);
    expect(invoke).toHaveBeenLastCalledWith('remove_tracks_from_playlist', {
      playlistId: 'pl-1',
      trackIds: ['track-2'],
    });

    invoke.mockResolvedValueOnce(undefined);
    await api.reorderTracks('pl-1', trackIds);
    expect(invoke).toHaveBeenLastCalledWith('reorder_playlist_tracks', {
      playlistId: 'pl-1',
      trackIds,
    });
    expect(trackIds).toEqual(['track-2', 'track-1', 'track-3']);
  });

  it('picks a cover through the native dialog and cover cache', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriPlaylistApi(commands);

    invoke.mockResolvedValueOnce('D:/Pictures/cover.jpg');
    invoke.mockResolvedValueOnce('D:/cache/playlists/cover.jpg');
    await expect(api.pickCover()).resolves.toEqual({
      cover_art_path: 'D:/cache/playlists/cover.jpg',
    });
    expect(invoke).toHaveBeenNthCalledWith(1, 'open_image_dialog');
    expect(invoke).toHaveBeenNthCalledWith(2, 'cache_playlist_cover', {
      sourcePath: 'D:/Pictures/cover.jpg',
    });

    invoke.mockResolvedValueOnce(null);
    await expect(api.pickCover()).resolves.toBeNull();
  });
});

describe('platform wiring', () => {
  it('exposes the matching playlist adapter on each runtime', () => {
    expect(createTauriPlatform().playlists).toBeInstanceOf(TauriPlaylistApi);
    expect(createMockPlatform().playlists).toBeInstanceOf(MockPlaylistApi);
    expect(createWebPlatform('/api').playlists).toBeInstanceOf(WebPlaylistApi);
  });

  it('routes signed-in desktop playlists through the cloud API, not SQLite', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const platform = createTauriPlatform({
      cloud: createCloudClient(request),
      isAuthenticated: () => true,
    });
    expect(platform.playlists).toBeInstanceOf(AccountBoundPlaylistApi);
    await platform.playlists.list();
    expect(request).toHaveBeenLastCalledWith('/v1/playlists');
  });

  it('keeps unsigned desktop playlists empty instead of reading SQLite', async () => {
    const request = vi.fn();
    const platform = createTauriPlatform({
      cloud: createCloudClient(request),
      isAuthenticated: () => false,
    });
    await expect(platform.playlists.list()).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('WebPlaylistApi', () => {
  it('loads and mutates playlists through the cloud API', async () => {
    const request = vi.fn();
    const api = new WebPlaylistApi(createCloudClient(request));
    const playlist = samplePlaylist({
      cover_art_path: 'https://cdn.example.test/covers/evening.jpg',
    });

    request.mockResolvedValueOnce([playlist]);
    await expect(api.list()).resolves.toEqual([playlist]);
    expect(request).toHaveBeenLastCalledWith('/v1/playlists');

    request.mockResolvedValueOnce(sampleDetails({ playlist, tracks: [sampleTrack()] }));
    await api.get('pl-1');
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/pl-1');

    request.mockResolvedValueOnce(playlist);
    await api.create({ name: 'Evening Mix', description: 'Late night' });
    expect(request).toHaveBeenLastCalledWith('/v1/playlists', {
      method: 'POST',
      body: {
        name: 'Evening Mix',
        description: 'Late night',
        is_smart: null,
        rules_json: null,
      },
    });

    request.mockResolvedValueOnce(playlist);
    await api.update({ id: 'pl-1', name: 'Night Mix' });
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/pl-1', {
      method: 'PATCH',
      body: { name: 'Night Mix' },
    });

    request.mockResolvedValueOnce(true);
    await api.delete('pl-1');
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/pl-1', { method: 'DELETE' });

    request.mockResolvedValueOnce(2);
    await api.addTracks('pl-1', ['track-2', 'track-1']);
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/pl-1/tracks', {
      method: 'POST',
      body: { track_ids: ['track-2', 'track-1'] },
    });

    request.mockResolvedValueOnce(1);
    await api.removeTracks('pl-1', ['track-2']);
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/pl-1/tracks', {
      method: 'DELETE',
      body: { track_ids: ['track-2'] },
    });

    request.mockResolvedValueOnce(undefined);
    await api.reorderTracks('pl-1', ['track-1', 'track-2']);
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/pl-1/order', {
      method: 'PUT',
      body: { track_ids: ['track-1', 'track-2'] },
    });
  });

  it('does not send filesystem cover paths to the cloud API', async () => {
    const request = vi.fn();
    const api = new WebPlaylistApi(createCloudClient(request));

    request.mockResolvedValueOnce(samplePlaylist({ cover_art_path: 'https://cdn.example.test/cover.jpg' }));
    await api.update({
      id: 'pl-1',
      name: 'Night Mix',
      cover_art_path: 'D:/Pictures/cover.jpg',
    });

    const [, options] = request.mock.calls[0] as [string, { body: { cover_art_path?: string } }];
    expect(options.body.cover_art_path).toBeUndefined();
    expect(JSON.stringify(request.mock.calls[0])).not.toMatch(/D:\/Pictures/);

    request.mockResolvedValueOnce([
      samplePlaylist({ cover_art_path: 'C:/cache/cover.jpg' }),
    ]);
    const listed = await api.list();
    expect(listed[0]?.cover_art_path).toBeNull();
    expect(JSON.stringify(listed)).not.toMatch(/C:\/cache/);
  });

  it('rejects the local cover picker', async () => {
    const request = vi.fn();
    const api = new WebPlaylistApi(createCloudClient(request));

    await expect(api.pickCover()).rejects.toBeInstanceOf(PlatformUnsupportedError);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('mock preview persistence', () => {
  it('continues to save playlists in mock preview storage', async () => {
    const created = await createMockPlatform().playlists.create({ name: 'Preview Mix' });
    const stored = Storage.getPlaylists();
    expect(stored?.some(playlist => playlist.id === created.id && playlist.name === 'Preview Mix')).toBe(true);
  });
});

describe('playlist consumers', () => {
  it('no longer import IpcService for playlist or cover operations', () => {
    const files = [
      '../context/PlaylistContext.tsx',
      '../components/views/PlaylistsView.tsx',
      '../components/views/PlaylistDetailView.tsx',
      '../components/layout/Sidebar.tsx',
    ];
    for (const file of files) {
      expect(source(file), file).not.toMatch(/IpcService/);
    }
  });
});

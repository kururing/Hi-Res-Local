import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CloudApiClient } from '../api/client';
import { persistFavoriteMutation } from '../context/LibraryContext';
import type { PlatformCommandGateway } from '../platform/contracts';
import { TauriFavoritesApi } from '../platform/favorites/IpcFavoritesApi';
import { MockFavoritesApi } from '../platform/mock/MockFavoritesApi';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebFavoritesApi } from '../platform/web/WebFavoritesApi';
import { AccountBoundFavoritesApi } from '../platform/hybrid/AccountBoundApis';

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

describe('TauriFavoritesApi', () => {
  it('invokes track, album, and artist mutations with the matching arguments', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriFavoritesApi(commands);

    invoke.mockResolvedValueOnce(undefined);
    await api.setTrackFavorite('track-1', true);
    expect(invoke).toHaveBeenLastCalledWith('set_track_favorite', {
      id: 'track-1',
      isFavorite: true,
    });

    invoke.mockResolvedValueOnce(undefined);
    await api.setAlbumFavorite('1÷x=1', 'Wanna One', false);
    expect(invoke).toHaveBeenLastCalledWith('set_album_favorite', {
      albumTitle: '1÷x=1',
      artistName: 'Wanna One',
      isFavorite: false,
    });

    invoke.mockResolvedValueOnce(undefined);
    await api.setArtistFavorite('Wanna One', true);
    expect(invoke).toHaveBeenLastCalledWith('set_artist_favorite', {
      artistName: 'Wanna One',
      isFavorite: true,
    });

    invoke.mockResolvedValueOnce([{ album_title: '1÷x=1', artist_name: 'Wanna One' }]);
    await api.getFavoriteAlbums();
    expect(invoke).toHaveBeenLastCalledWith('get_favorite_albums');

    invoke.mockResolvedValueOnce(['Wanna One']);
    await api.getFavoriteArtists();
    expect(invoke).toHaveBeenLastCalledWith('get_favorite_artists');
  });
});

describe('AccountBoundFavoritesApi', () => {
  it('rejects unsigned favorite mutations instead of silently no-oping', () => {
    const request = vi.fn();
    const api = new AccountBoundFavoritesApi(
      new WebFavoritesApi(createCloudClient(request)),
      () => false,
    );
    expect(() => api.setTrackFavorite('track-1', true)).toThrow(/Sign in to use favorites/);
    expect(() => api.setAlbumFavorite('1÷x=1', 'Wanna One', true)).toThrow(/Sign in to use favorites/);
    expect(() => api.setArtistFavorite('Wanna One', true)).toThrow(/Sign in to use favorites/);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('platform wiring', () => {
  it('exposes the matching favorites adapter on each runtime', () => {
    expect(createTauriPlatform().favorites).toBeInstanceOf(TauriFavoritesApi);
    expect(createMockPlatform().favorites).toBeInstanceOf(MockFavoritesApi);
    expect(createWebPlatform('/api').favorites).toBeInstanceOf(WebFavoritesApi);
  });

  it('uses the cloud favorites API on signed-in desktop', () => {
    const platform = createTauriPlatform({
      cloud: createCloudClient(vi.fn()),
      isAuthenticated: () => true,
    });
    expect(platform.favorites).toBeInstanceOf(AccountBoundFavoritesApi);
  });
});

describe('WebFavoritesApi', () => {
  it('uses PUT when favoriting and DELETE when removing a favorite', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const api = new WebFavoritesApi(createCloudClient(request));

    await api.setTrackFavorite('track-1', true);
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/tracks/track-1', { method: 'PUT' });

    await api.setTrackFavorite('track-1', false);
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/tracks/track-1', { method: 'DELETE' });

    await api.setAlbumFavorite('1÷x=1', 'Wanna One', true);
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/albums', {
      method: 'PUT',
      body: { album_title: '1÷x=1', artist_name: 'Wanna One' },
    });

    await api.setAlbumFavorite('1÷x=1', 'Wanna One', false);
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/albums', {
      method: 'DELETE',
      body: { album_title: '1÷x=1', artist_name: 'Wanna One' },
    });

    await api.setArtistFavorite('Wanna One', true);
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/artists', {
      method: 'PUT',
      body: { artist_name: 'Wanna One' },
    });

    await api.setArtistFavorite('Wanna One', false);
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/artists', {
      method: 'DELETE',
      body: { artist_name: 'Wanna One' },
    });

    request.mockResolvedValueOnce([{ album_title: '1÷x=1', artist_name: 'Wanna One' }]);
    await api.getFavoriteAlbums();
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/albums');

    request.mockResolvedValueOnce(['Wanna One']);
    await api.getFavoriteArtists();
    expect(request).toHaveBeenLastCalledWith('/v1/favorites/artists');
  });

  it('does not send local filesystem paths in favorite requests', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const api = new WebFavoritesApi(createCloudClient(request));

    await api.setTrackFavorite('track-1', true);
    await api.setAlbumFavorite('1÷x=1', 'Wanna One', true);
    await api.setArtistFavorite('Wanna One', true);

    const serialized = JSON.stringify(request.mock.calls);
    expect(serialized).not.toMatch(/D:\//);
    expect(serialized).not.toMatch(/C:\//);
    expect(serialized).not.toMatch(/file:/);
  });
});

describe('optimistic favorite state', () => {
  it('rolls back when the favorite API fails', async () => {
    const ids = new Set<string>(['track-1']);
    const rollback = () => { ids.delete('track-1'); };

    await expect(
      persistFavoriteMutation(Promise.reject(new Error('backend down')), rollback)
    ).rejects.toThrow('backend down');
    expect(ids.has('track-1')).toBe(false);
  });

  it('keeps optimistic state when the favorite API succeeds', async () => {
    const ids = new Set<string>(['track-1']);
    const rollback = vi.fn(() => { ids.delete('track-1'); });

    await persistFavoriteMutation(Promise.resolve(), rollback);
    expect(rollback).not.toHaveBeenCalled();
    expect(ids.has('track-1')).toBe(true);
  });
});

describe('favorites consumers', () => {
  it('no longer import IpcService or invoke favorite commands directly', () => {
    expect(source('../context/LibraryContext.tsx')).not.toMatch(/IpcService/);
    expect(source('../context/LibraryContext.tsx')).not.toMatch(/commands\.invoke/);
    expect(source('../components/views/FavoritesView.tsx')).not.toMatch(/IpcService/);
  });
});

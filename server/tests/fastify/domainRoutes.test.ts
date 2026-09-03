import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../../src/config/env.js';
import { AppError, ErrorCodes } from '../../src/errors/appError.js';
import type { FrontendTrack } from '../../src/catalog/mapper.js';
import type { PlaylistService } from '../../src/playlists/service.js';
import type { FavoritesService } from '../../src/favorites/service.js';
import type { HistoryService } from '../../src/history/service.js';
import type { LyricsService } from '../../src/lyrics/service.js';
import { FakeObjectStorageSigner } from '../../src/storage/fakeSigner.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TRACK = '33333333-3333-4333-8333-333333333331';
const PLAYLIST = '44444444-4444-4444-8444-444444444441';

function throwingPool(): Pool {
  const fail = () => {
    throw new Error('Fake Fastify tests must not query PostgreSQL');
  };
  return { query: fail, connect: fail, end: async () => undefined } as unknown as Pool;
}

const sampleTrack: FrontendTrack = {
  id: TRACK,
  title: 'Lanterns Over Water',
  artist: 'Aurora Circuit',
  album: 'Glass Harbor',
  duration: 214.5,
  duration_ms: 214500,
  path: '',
  track_number: 1,
  disc_number: 1,
  year: 2024,
  genre: 'Electronic',
  sample_rate: 96_000,
  bitrate: 3200,
  channels: 2,
  date_added: '2026-08-29T00:00:00.000Z',
  is_favorite: true,
  play_count: 2,
  last_played: '2026-08-29T12:00:00.000Z',
  lyrics: null,
  format: 'FLAC',
  bits_per_sample: 24,
  bit_depth: 24,
  cover_art_path: 'https://cdn.example.test/covers/glass-harbor.jpg',
  artist_image_url: null,
  last_played_at: '2026-08-29T12:00:00.000Z',
};

const samplePlaylist = {
  id: PLAYLIST,
  name: 'Harbor Mix',
  description: 'Test',
  is_smart: false,
  rules_json: null,
  cover_art_path: null,
  track_count: 1,
  total_duration_ms: 214500,
  created_at: '2026-08-29T00:00:00.000Z',
  updated_at: '2026-08-29T00:00:00.000Z',
};

const playlistService = {
  list: async () => [samplePlaylist],
  get: async () => ({ playlist: samplePlaylist, tracks: [sampleTrack] }),
  create: async () => samplePlaylist,
  update: async () => samplePlaylist,
  delete: async () => true,
  addTracks: async () => 1,
  removeTracks: async () => 1,
  reorderTracks: async () => undefined,
} as unknown as PlaylistService;

const favoritesService = {
  setTrackFavorite: async () => undefined,
  setAlbumFavorite: async () => undefined,
  setArtistFavorite: async () => undefined,
  listAlbums: async () => [{ album_title: 'Glass Harbor', artist_name: 'Aurora Circuit' }],
  listArtists: async () => ['Aurora Circuit'],
} as unknown as FavoritesService;

const historyService = {
  record: async () => ({
    id: 1,
    track_id: TRACK,
    track: sampleTrack,
    played_at: '2026-08-29T12:00:00.000Z',
    completed_duration_ms: 120000,
    fully_played: false,
  }),
  list: async () => [{
    id: 1,
    track_id: TRACK,
    track: sampleTrack,
    played_at: '2026-08-29T12:00:00.000Z',
    completed_duration_ms: 120000,
    fully_played: false,
  }],
  clear: async () => 3,
} as unknown as HistoryService;

const lyricsService = {
  getCached: async () => {
    throw new AppError(404, ErrorCodes.LYRICS_NOT_FOUND, 'Lyrics not found.');
  },
  resolve: async () => ({
    is_synced: true,
    lines: [{ timestamp_seconds: 0, text: 'Glass on the harbor' }],
    plain_text: 'Glass on the harbor',
    source: 'lrclib',
    instrumental: false,
    title: 'Lanterns Over Water',
    artist: 'Aurora Circuit',
    album: 'Glass Harbor',
    by: null,
    offset: 0,
  }),
} as unknown as LyricsService;

const app = await buildApp({
  config: testConfig(),
  pool: throwingPool(),
  signer: new FakeObjectStorageSigner(),
  logger: false,
  playlistService,
  favoritesService,
  historyService,
  lyricsService,
  authenticate: async (request) => {
    request.authUser = { id: USER, sessionId: 'sess' };
  },
});
await app.ready();

describe('Fastify domain routes with fake services', () => {
  afterAll(async () => {
    await app.close();
  });

  it('returns playlist arrays and details without an envelope', async () => {
    const list = await app.inject({ url: '/v1/playlists' });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);
    expect(list.json()[0]).toMatchObject({ id: PLAYLIST, name: 'Harbor Mix', is_smart: false });

    const details = await app.inject({ url: `/v1/playlists/${PLAYLIST}` });
    expect(details.json().playlist.id).toBe(PLAYLIST);
    expect(details.json().tracks[0].is_favorite).toBe(true);

    const added = await app.inject({
      method: 'POST',
      url: `/v1/playlists/${PLAYLIST}/tracks`,
      payload: { track_ids: [TRACK] },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toBe(1);

    const order = await app.inject({
      method: 'PUT',
      url: `/v1/playlists/${PLAYLIST}/order`,
      payload: { track_ids: [TRACK] },
    });
    expect(order.statusCode).toBe(204);
    expect(order.body).toBe('');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/playlists/${PLAYLIST}`,
    });
    expect(removed.json()).toBe(true);
  });

  it('returns favorite arrays and 204 mutations', async () => {
    const albums = await app.inject({ url: '/v1/favorites/albums' });
    expect(albums.json()).toEqual([{ album_title: 'Glass Harbor', artist_name: 'Aurora Circuit' }]);
    const artists = await app.inject({ url: '/v1/favorites/artists' });
    expect(artists.json()).toEqual(['Aurora Circuit']);
    const put = await app.inject({ method: 'PUT', url: `/v1/favorites/tracks/${TRACK}` });
    expect(put.statusCode).toBe(204);
  });

  it('returns history primitives expected by WebHistoryApi', async () => {
    const list = await app.inject({ url: '/v1/history?limit=10&offset=0' });
    expect(Array.isArray(list.json())).toBe(true);
    expect(list.json()[0].id).toBe(1);
    const cleared = await app.inject({ method: 'DELETE', url: '/v1/history' });
    expect(cleared.json()).toBe(3);
  });

  it('returns lyrics 404 as a domain error envelope', async () => {
    const missing = await app.inject({ url: `/v1/tracks/${TRACK}/lyrics` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'LYRICS_NOT_FOUND', request_id: expect.any(String) });

    const resolved = await app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      payload: { track_id: TRACK, title: 'ignored', artist: 'ignored', album: 'ignored', duration_seconds: 1 },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().lines[0].timestamp_seconds).toBe(0);
  });

  it('exposes the new paths in OpenAPI', async () => {
    const spec = await app.inject({ url: '/docs/openapi.json' });
    const paths = spec.json().paths;
    expect(paths['/v1/playlists']).toBeTruthy();
    expect(paths['/v1/favorites/albums']).toBeTruthy();
    expect(paths['/v1/history']).toBeTruthy();
    expect(paths['/v1/tracks/{trackId}/lyrics']).toBeTruthy();
    expect(paths['/v1/lyrics/resolve']).toBeTruthy();
  });
});

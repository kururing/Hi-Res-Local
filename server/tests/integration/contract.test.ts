import { afterEach, expect, it } from 'vitest';
import { createWebDomainApis } from '../helpers/webContract.js';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('frontend contract', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  it('returns WebLibraryApi shapes for /v1/library/*', async () => {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: 'web@example.com', password: 'correct-horse', display_name: 'Web' },
    });
    const headers = { authorization: `Bearer ${registered.json().access_token}` };

    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/library/tracks/${ctx.fixture.trackId}`,
      headers,
    });

    const tracks = await ctx.app.inject({ url: '/v1/library/tracks', headers });
    expect(Array.isArray(tracks.json())).toBe(true);
    const track = tracks.json()[0];
    for (const key of ['id', 'title', 'artist', 'album', 'duration', 'path', 'date_added']) {
      expect(track).toHaveProperty(key);
    }
    expect(track.path).toBe('');

    const catalog = await ctx.app.inject({ url: '/v1/catalog/tracks', headers });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().some((item: { id: string }) => item.id === ctx.fixture.trackId)).toBe(true);

    const stats = await ctx.app.inject({ url: '/v1/library/stats', headers });
    expect(stats.json()).toEqual(expect.objectContaining({
      total_tracks: expect.any(Number),
      total_artists: expect.any(Number),
      total_albums: expect.any(Number),
      total_duration_secs: expect.any(Number),
    }));

    const roots = await ctx.app.inject({ url: '/v1/library/roots', headers });
    expect(roots.json()).toEqual([]);
  });

  it('matches WebPlaylistApi, WebFavoritesApi, WebHistoryApi, and WebLyricsApi', async () => {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: 'adapters@example.com', password: 'correct-horse', display_name: 'Adapters' },
    });
    const apis = createWebDomainApis(ctx.app, registered.json().access_token);

    const catalogTracks = await apis.library.getAllTracks();
    expect(catalogTracks.some((item) => item.id === ctx.fixture.trackId)).toBe(true);
    expect(catalogTracks.every((item) => item.path === '')).toBe(true);
    expect((await apis.library.getStats()).total_tracks).toBeGreaterThanOrEqual(catalogTracks.length);

    const created = await apis.playlists.create({ name: 'Adapter Mix', description: null, is_smart: false, rules_json: null });
    expect(created.name).toBe('Adapter Mix');
    expect(Array.isArray(await apis.playlists.list())).toBe(true);
    const added = await apis.playlists.addTracks(created.id, [ctx.fixture.trackId]);
    expect(added).toBe(1);
    const details = await apis.playlists.get(created.id);
    expect(details.tracks[0]?.id).toBe(ctx.fixture.trackId);
    await apis.playlists.reorderTracks(created.id, [ctx.fixture.trackId]);
    expect(await apis.playlists.removeTracks(created.id, [ctx.fixture.trackId])).toBe(1);
    expect(await apis.playlists.delete(created.id)).toBe(true);

    await apis.favorites.setTrackFavorite(ctx.fixture.trackId, true);
    await apis.favorites.setAlbumFavorite('Glass Harbor', 'Aurora Circuit', true);
    await apis.favorites.setArtistFavorite('Aurora Circuit', true);
    expect(await apis.favorites.getFavoriteAlbums()).toEqual([
      { album_title: 'Glass Harbor', artist_name: 'Aurora Circuit' },
    ]);
    expect(await apis.favorites.getFavoriteArtists()).toEqual(['Aurora Circuit']);
    await apis.favorites.setTrackFavorite(ctx.fixture.trackId, false);

    const entry = await apis.history.record({
      track_id: ctx.fixture.trackId,
      completed_duration_ms: 1000,
      fully_played: false,
      client_request_id: 'adapter-1',
    });
    expect(entry.track_id).toBe(ctx.fixture.trackId);
    expect(Array.isArray(await apis.history.list({ limit: 10, offset: 0 }))).toBe(true);
    expect(await apis.history.clear()).toBeGreaterThanOrEqual(1);

    ctx.lyricsProvider.nextResult = {
      instrumental: false,
      syncedLrc: '[00:00.00]Adapter line\n',
      plainText: 'Adapter line',
      source: 'lrclib',
    };
    const lyrics = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: { authorization: `Bearer ${registered.json().access_token}` },
      payload: {
        track_id: ctx.fixture.trackId,
        title: 'ignored',
        artist: 'ignored',
        album: 'ignored',
        duration_seconds: 1,
      },
    });
    expect(lyrics.statusCode).toBe(200);
    expect(lyrics.json()).toMatchObject({
      is_synced: true,
      source: 'lrclib',
      plain_text: expect.stringContaining('Adapter line'),
    });
    expect(Array.isArray(lyrics.json().lines)).toBe(true);

    const stream = await apis.streaming.createStream(ctx.fixture.trackId, {
      quality: 'auto',
      supportedFormats: [
        { codec: 'flac', container: 'flac', mimeType: 'audio/flac', confidence: 'probably' },
        { codec: 'mp3', container: 'mp3', mimeType: 'audio/mpeg', confidence: 'probably' },
      ],
    });
    expect(Date.parse(stream.expiresAt)).toBeGreaterThan(Date.now() - 1000);
    expect(stream.asset.codec).toBeTruthy();
    expect(JSON.stringify(stream)).not.toContain('storage_key');
  });

  it('keeps a stable error envelope', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-request-id': requestId },
    });
    expect(response.json()).toEqual({
      code: 'AUTH_UNAUTHORIZED',
      message: expect.any(String),
      request_id: requestId,
    });
  });
});

describeIntegration('openapi', handle, (ctx) => {
  it('generates an OpenAPI document from route schemas', async () => {
    const response = await ctx.app.inject({ url: '/docs/openapi.json' });
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths['/v1/auth/login']).toBeTruthy();
    expect(spec.paths['/v1/catalog/tracks']).toBeTruthy();
    expect(spec.paths['/v1/catalog/stats']).toBeTruthy();
    expect(spec.paths['/v1/library/tracks']).toBeTruthy();
    expect(spec.paths['/v1/playlists']).toBeTruthy();
    expect(spec.paths['/v1/favorites/albums']).toBeTruthy();
    expect(spec.paths['/v1/history']).toBeTruthy();
    expect(spec.paths['/v1/lyrics/resolve']).toBeTruthy();
    expect(spec.paths['/v1/tracks/{trackId}/stream']).toBeTruthy();
    expect(spec.paths['/v1/tracks/{trackId}/stream'].post.requestBody.content['application/json'].schema.properties.supported_formats).toBeTruthy();
    expect(spec.paths['/v1/tracks/{trackId}/stream'].post.responses['200'].content['application/json'].schema.properties.asset.properties.mime_type).toBeTruthy();
    expect(spec.paths['/health/live']).toBeTruthy();
  });

  it('reports process liveness without authentication', async () => {
    const live = await ctx.app.inject({ url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
  });
});

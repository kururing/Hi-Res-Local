import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('catalog integration', handle, (ctx) => {

  afterEach(async () => {
    await resetIntegration();
  });

  async function authHeader(): Promise<string> {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: 'catalog@example.com', password: 'correct-horse', display_name: 'Cat' },
    });
    return `Bearer ${registered.json().access_token}`;
  }

  it('searches with cursor pagination and never leaks storage_key', async () => {
    const authorization = await authHeader();
    const first = await ctx.app.inject({
      url: '/v1/catalog/search?q=a&type=track&limit=1',
      headers: { authorization },
    });
    expect(first.statusCode).toBe(200);
    const page1 = first.json();
    expect(page1.items).toHaveLength(1);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBeTruthy();
    expect(JSON.stringify(page1)).not.toContain('storage_key');
    expect(JSON.stringify(page1)).not.toContain(ctx.fixture.hiResKey);

    const second = await ctx.app.inject({
      url: `/v1/catalog/search?q=a&type=track&limit=1&cursor=${encodeURIComponent(page1.next_cursor)}`,
      headers: { authorization },
    });
    const page2 = second.json();
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  it('returns artist, album, and track details matching the frontend mapper', async () => {
    const authorization = await authHeader();
    const track = await ctx.app.inject({
      url: `/v1/catalog/tracks/${ctx.fixture.trackId}`,
      headers: { authorization },
    });
    expect(track.statusCode).toBe(200);
    expect(track.json()).toMatchObject({
      id: ctx.fixture.trackId,
      title: 'Lanterns Over Water',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
      path: '',
      sample_rate: 96_000,
      bit_depth: 24,
      format: 'FLAC',
      artist_image_url: null,
    });
    expect(JSON.stringify(track.json())).not.toContain('storage_key');

    const album = await ctx.app.inject({
      url: `/v1/catalog/albums/${ctx.fixture.albumId}`,
      headers: { authorization },
    });
    expect(album.json().tracks.length).toBeGreaterThanOrEqual(2);
    expect(album.json().name).toBe('Glass Harbor');

    const artist = await ctx.app.inject({
      url: `/v1/catalog/artists/${ctx.fixture.artistId}`,
      headers: { authorization },
    });
    expect(artist.json().name).toBe('Aurora Circuit');
    expect(artist.json().image_url).toBeNull();
    expect(artist.json().albums[0].tracks).toEqual([]);

    const albumTracks = await ctx.app.inject({
      url: `/v1/catalog/albums/${ctx.fixture.albumId}/tracks`,
      headers: { authorization },
    });
    expect(Array.isArray(albumTracks.json())).toBe(true);

    const artistAlbums = await ctx.app.inject({
      url: `/v1/catalog/artists/${ctx.fixture.artistId}/albums`,
      headers: { authorization },
    });
    expect(artistAlbums.json()[0].id).toBe(ctx.fixture.albumId);
  });

  it('exposes admin-uploaded artist portraits on artist and track payloads', async () => {
    const authorization = await authHeader();
    const imageUrl = 'https://cdn.example.test/artists/aurora.jpg';
    await ctx.pool.query('UPDATE artists SET image_url = $1 WHERE id = $2', [imageUrl, ctx.fixture.artistId]);

    const artist = await ctx.app.inject({
      url: `/v1/catalog/artists/${ctx.fixture.artistId}`,
      headers: { authorization },
    });
    expect(artist.json().image_url).toBe(imageUrl);

    const track = await ctx.app.inject({
      url: `/v1/catalog/tracks/${ctx.fixture.trackId}`,
      headers: { authorization },
    });
    expect(track.json().artist_image_url).toBe(imageUrl);

    const search = await ctx.app.inject({
      url: '/v1/catalog/search?q=Aurora&type=artist',
      headers: { authorization },
    });
    expect(search.json().items[0].artist.image_url).toBe(imageUrl);
  });

  it('lists published catalog tracks without requiring a personal library', async () => {
    const authorization = await authHeader();
    const draftId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO tracks (id, title, album_id, track_number, duration_seconds, available, publication_state)
       VALUES ($1, 'Hidden Draft', $2, 99, 90, TRUE, 'draft')`,
      [draftId, ctx.fixture.albumId],
    );

    const listed = await ctx.app.inject({
      url: '/v1/catalog/tracks',
      headers: { authorization },
    });
    expect(listed.statusCode).toBe(200);
    const tracks = listed.json() as Array<{ id: string; path: string; title: string }>;
    const ids = tracks.map((track) => track.id);
    expect(ids).toContain(ctx.fixture.trackId);
    expect(ids).not.toContain(draftId);
    expect(tracks.every((track) => track.path === '')).toBe(true);
    expect(JSON.stringify(tracks)).not.toContain('storage_key');

    const library = await ctx.app.inject({
      url: '/v1/library/tracks',
      headers: { authorization },
    });
    expect(library.json()).toEqual([]);

    const stats = await ctx.app.inject({
      url: '/v1/catalog/stats',
      headers: { authorization },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toEqual(expect.objectContaining({
      total_tracks: tracks.length,
      total_artists: expect.any(Number),
      total_albums: expect.any(Number),
      total_duration_secs: expect.any(Number),
    }));
    expect(stats.json().total_tracks).toBeGreaterThanOrEqual(3);

    const pagedTracks = await ctx.app.inject({
      url: '/v1/catalog/tracks?limit=1',
      headers: { authorization },
    });
    expect(pagedTracks.statusCode).toBe(200);
    expect(pagedTracks.json().items).toHaveLength(1);
    expect(pagedTracks.json().has_more).toBe(true);
    expect(pagedTracks.json().next_cursor).toBeTruthy();

    const artists = await ctx.app.inject({
      url: '/v1/catalog/artists?limit=10',
      headers: { authorization },
    });
    expect(artists.statusCode).toBe(200);
    expect(artists.json().items.some((item: { id: string }) => item.id === ctx.fixture.artistId)).toBe(true);
    expect(artists.json().items[0].albums).toEqual([]);
    expect(JSON.stringify(artists.json())).not.toContain('storage_key');

    const albums = await ctx.app.inject({
      url: '/v1/catalog/albums?limit=10',
      headers: { authorization },
    });
    expect(albums.statusCode).toBe(200);
    expect(albums.json().items.some((item: { id: string }) => item.id === ctx.fixture.albumId)).toBe(true);
    expect(albums.json().items[0].tracks).toEqual([]);
  });

  it('loads album tracks without N+1 queries', async () => {
    for (let index = 0; index < 8; index += 1) {
      const extraId = randomUUID();
      await ctx.pool.query(
        `INSERT INTO tracks (id, title, album_id, track_number, duration_seconds, available)
         VALUES ($1, $2, $3, $4, 120, TRUE)`,
        [extraId, `Extra ${index}`, ctx.fixture.albumId, 10 + index],
      );
      await ctx.pool.query(
        `INSERT INTO track_artists (track_id, artist_id, role, position) VALUES ($1, $2, 'primary', 0)`,
        [extraId, ctx.fixture.artistId],
      );
    }

    const original = ctx.pool.query.bind(ctx.pool);
    let count = 0;
    (ctx.pool as unknown as { query: typeof ctx.pool.query }).query = ((...args: unknown[]) => {
      count += 1;
      return original(...(args as Parameters<typeof original>));
    }) as typeof ctx.pool.query;

    try {
      const authorization = await authHeader();
      count = 0;
      const album = await ctx.app.inject({
        url: `/v1/catalog/albums/${ctx.fixture.albumId}`,
        headers: { authorization },
      });
      expect(album.statusCode).toBe(200);
      expect(album.json().tracks.length).toBeGreaterThanOrEqual(10);
      expect(count).toBeLessThanOrEqual(4);
    } finally {
      (ctx.pool as unknown as { query: typeof ctx.pool.query }).query = original;
    }
  });
});

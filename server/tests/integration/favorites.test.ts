import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('favorites integration', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function register(email: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'correct-horse', display_name: email },
    });
    return { headers: { authorization: `Bearer ${response.json().access_token}` } };
  }

  async function insertAmbiguousNames() {
    const artistA = randomUUID();
    const artistB = randomUUID();
    const near = randomUUID();
    const albumA = randomUUID();
    const albumB = randomUUID();
    await ctx.pool.query(
      `INSERT INTO artists (id, name, sort_name) VALUES
         ($1, 'Twin Peak', 'twin peak'),
         ($2, 'Twin Peak', 'twin peak'),
         ($3, 'Twin Peak Ensemble', 'twin peak ensemble')`,
      [artistA, artistB, near],
    );
    await ctx.pool.query(
      `INSERT INTO albums (id, title, primary_artist_id) VALUES
         ($1, 'Mirror Lake', $3),
         ($2, 'Mirror Lake', $4)`,
      [albumA, albumB, artistA, artistB],
    );
    return { artistA, artistB, near, albumA, albumB };
  }

  it('favorites tracks, albums, and artists idempotently with isolation', async () => {
    const userA = await register('fav-a@example.com');
    const userB = await register('fav-b@example.com');

    const first = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/favorites/tracks/${ctx.fixture.trackId}`,
      headers: userA.headers,
    });
    const second = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/favorites/tracks/${ctx.fixture.trackId}`,
      headers: userA.headers,
    });
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);

    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/library/tracks/' + ctx.fixture.trackId,
      headers: userA.headers,
    });
    const library = await ctx.app.inject({ url: '/v1/library/tracks', headers: userA.headers });
    expect(library.json()[0].is_favorite).toBe(true);

    const otherLibraryPut = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/library/tracks/' + ctx.fixture.trackId,
      headers: userB.headers,
    });
    expect(otherLibraryPut.statusCode).toBe(204);
    const otherLibrary = await ctx.app.inject({ url: '/v1/library/tracks', headers: userB.headers });
    expect(otherLibrary.json()[0].is_favorite).toBe(false);

    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/favorites/albums',
      headers: userA.headers,
      payload: { album_title: 'Glass Harbor', artist_name: 'Aurora Circuit' },
    });
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/favorites/artists',
      headers: userA.headers,
      payload: { artist_name: 'Aurora Circuit' },
    });
    const albums = await ctx.app.inject({ url: '/v1/favorites/albums', headers: userA.headers });
    const artists = await ctx.app.inject({ url: '/v1/favorites/artists', headers: userA.headers });
    expect(albums.json()).toEqual([{ album_title: 'Glass Harbor', artist_name: 'Aurora Circuit' }]);
    expect(artists.json()).toEqual(['Aurora Circuit']);
    expect((await ctx.app.inject({ url: '/v1/favorites/albums', headers: userB.headers })).json()).toEqual([]);

    const missing = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/favorites/tracks/${randomUUID()}`,
      headers: userA.headers,
    });
    expect(missing.statusCode).toBe(404);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/favorites/tracks/${ctx.fixture.trackId}`,
      headers: userA.headers,
    });
    const delAgain = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/favorites/tracks/${ctx.fixture.trackId}`,
      headers: userA.headers,
    });
    expect(del.statusCode).toBe(204);
    expect(delAgain.statusCode).toBe(204);
    const after = await ctx.app.inject({ url: '/v1/library/tracks', headers: userA.headers });
    expect(after.json()[0].is_favorite).toBe(false);
  });

  it('resolves names exactly and rejects ambiguous catalog names', async () => {
    const user = await register('fav-amb@example.com');
    await insertAmbiguousNames();

    const ambiguousArtist = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/favorites/artists',
      headers: user.headers,
      payload: { artist_name: 'Twin Peak' },
    });
    expect(ambiguousArtist.statusCode).toBe(409);
    expect(ambiguousArtist.json().code).toBe('FAVORITE_AMBIGUOUS');

    const near = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/favorites/artists',
      headers: user.headers,
      payload: { artist_name: 'Twin Peak Ensemble' },
    });
    expect(near.statusCode).toBe(204);

    const ambiguousAlbum = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/favorites/albums',
      headers: user.headers,
      payload: { album_title: 'Mirror Lake', artist_name: 'Twin Peak' },
    });
    expect(ambiguousAlbum.statusCode).toBe(409);

    const missing = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/favorites/artists',
      headers: user.headers,
      payload: { artist_name: 'Nobody Here' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('does not issue N+1 queries when mapping favorite state onto library tracks', async () => {
    const user = await register('fav-n1@example.com');
    for (let index = 0; index < 8; index += 1) {
      const extraId = randomUUID();
      await ctx.pool.query(
        `INSERT INTO tracks (id, title, album_id, duration_seconds, available) VALUES ($1, $2, $3, 90, TRUE)`,
        [extraId, `Extra ${index}`, ctx.fixture.albumId],
      );
      await ctx.app.inject({
        method: 'PUT',
        url: `/v1/library/tracks/${extraId}`,
        headers: user.headers,
      });
      if (index % 2 === 0) {
        await ctx.app.inject({
          method: 'PUT',
          url: `/v1/favorites/tracks/${extraId}`,
          headers: user.headers,
        });
      }
    }

    const original = ctx.pool.query.bind(ctx.pool);
    let count = 0;
    (ctx.pool as unknown as { query: typeof ctx.pool.query }).query = ((...args: unknown[]) => {
      count += 1;
      return original(...(args as Parameters<typeof original>));
    }) as typeof ctx.pool.query;

    try {
      count = 0;
      const tracks = await ctx.app.inject({ url: '/v1/library/tracks', headers: user.headers });
      expect(tracks.statusCode).toBe(200);
      expect(tracks.json().length).toBeGreaterThanOrEqual(8);
      expect(count).toBeLessThanOrEqual(4);
    } finally {
      (ctx.pool as unknown as { query: typeof ctx.pool.query }).query = original;
    }
  });
});

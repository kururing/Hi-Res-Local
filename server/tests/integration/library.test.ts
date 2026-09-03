import { afterEach, expect, it } from 'vitest';
import { withTransaction } from '../../src/db/types.js';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('library integration', handle, (ctx) => {

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
    return {
      token: response.json().access_token as string,
      userId: response.json().user.id as string,
    };
  }

  it('adds and removes tracks idempotently and isolates users', async () => {
    const userA = await register('a@example.com');
    const userB = await register('b@example.com');
    const authA = { authorization: `Bearer ${userA.token}` };
    const authB = { authorization: `Bearer ${userB.token}` };

    const firstPut = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/library/tracks/${ctx.fixture.trackId}`,
      headers: authA,
    });
    const secondPut = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/library/tracks/${ctx.fixture.trackId}`,
      headers: authA,
    });
    expect(firstPut.statusCode).toBe(204);
    expect(secondPut.statusCode).toBe(204);

    const unavailablePut = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/library/tracks/${ctx.fixture.unavailableTrackId}`,
      headers: authA,
    });
    expect(unavailablePut.statusCode).toBe(204);

    const tracks = await ctx.app.inject({ url: '/v1/library/tracks', headers: authA });
    expect(tracks.statusCode).toBe(200);
    expect(tracks.json()).toHaveLength(2);
    expect(tracks.json().every((track: { path: string }) => track.path === '')).toBe(true);

    const stats = await ctx.app.inject({ url: '/v1/library/stats', headers: authA });
    expect(stats.json()).toMatchObject({
      total_tracks: 2,
      total_artists: 1,
      total_albums: 1,
    });
    expect(typeof stats.json().total_duration_secs).toBe('number');

    const roots = await ctx.app.inject({ url: '/v1/library/roots', headers: authA });
    expect(roots.json()).toEqual([]);

    const otherTracks = await ctx.app.inject({ url: '/v1/library/tracks', headers: authB });
    expect(otherTracks.json()).toEqual([]);

    const firstDelete = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/library/tracks/${ctx.fixture.trackId}`,
      headers: authA,
    });
    const secondDelete = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/library/tracks/${ctx.fixture.trackId}`,
      headers: authA,
    });
    expect(firstDelete.statusCode).toBe(204);
    expect(secondDelete.statusCode).toBe(204);
  });

  it('syncs changes with a stable cursor and no duplicates or gaps', async () => {
    const user = await register('sync@example.com');
    const headers = { authorization: `Bearer ${user.token}` };

    await ctx.app.inject({ method: 'PUT', url: `/v1/library/tracks/${ctx.fixture.trackId}`, headers });
    await ctx.app.inject({ method: 'PUT', url: `/v1/library/tracks/${ctx.fixture.unavailableTrackId}`, headers });
    await ctx.app.inject({ method: 'DELETE', url: `/v1/library/tracks/${ctx.fixture.trackId}`, headers });
    await ctx.app.inject({ method: 'PUT', url: `/v1/library/tracks/${ctx.fixture.trackId}`, headers });

    const first = await ctx.app.inject({ url: '/v1/library/changes?limit=2', headers });
    const page1 = first.json();
    expect(page1.changes).toHaveLength(2);
    expect(page1.has_more).toBe(true);

    const second = await ctx.app.inject({
      url: `/v1/library/changes?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`,
      headers,
    });
    const page2 = second.json();
    const ids = [...page1.changes, ...page2.changes].map((change: { change_id: string }) => change.change_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a) - Number(b)));
    expect([...page1.changes, ...page2.changes].map((change: { operation: string }) => change.operation))
      .toEqual(['upsert', 'upsert', 'delete', 'upsert']);
  });

  it('rolls back a library item when the surrounding transaction fails', async () => {
    const user = await register('tx@example.com');
    await expect(withTransaction(ctx.pool, async (client) => {
      await client.query(
        `INSERT INTO user_library_tracks (user_id, track_id) VALUES ($1, $2)`,
        [user.userId, ctx.fixture.trackId],
      );
      await client.query(
        `INSERT INTO library_changes (user_id, entity_type, operation, entity_id)
         VALUES ($1, 'track', 'upsert', $2)`,
        [user.userId, ctx.fixture.trackId],
      );
      throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');

    const items = await ctx.pool.query(
      'SELECT 1 FROM user_library_tracks WHERE user_id = $1',
      [user.userId],
    );
    const changes = await ctx.pool.query(
      'SELECT 1 FROM library_changes WHERE user_id = $1',
      [user.userId],
    );
    expect(items.rowCount).toBe(0);
    expect(changes.rowCount).toBe(0);
  });
});

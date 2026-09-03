import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('playlists integration', handle, (ctx) => {
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
      headers: { authorization: `Bearer ${response.json().access_token}` },
    };
  }

  it('supports CRUD, counts, isolation, and membership', async () => {
    const userA = await register('pl-a@example.com');
    const userB = await register('pl-b@example.com');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: userA.headers,
      payload: { name: '  Harbor Mix  ', description: null, is_smart: false, rules_json: null },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      name: 'Harbor Mix',
      is_smart: false,
      rules_json: null,
      track_count: 0,
      total_duration_ms: 0,
    });

    const smart = await ctx.app.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: userA.headers,
      payload: { name: 'Smart Harbor', is_smart: true, rules_json: { type: 'genre', value: 'electronic' } },
    });
    expect(smart.statusCode).toBe(200);
    expect(smart.json().rules_json).toBe('{"type":"genre","value":"electronic"}');

    const blankRules = await ctx.app.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: userA.headers,
      payload: { name: 'Blank Rules', rules_json: '' },
    });
    expect(blankRules.statusCode).toBe(200);
    expect(blankRules.json().rules_json).toBeNull();
    const playlistId = created.json().id as string;

    const added = await ctx.app.inject({
      method: 'POST',
      url: `/v1/playlists/${playlistId}/tracks`,
      headers: userA.headers,
      payload: { track_ids: [ctx.fixture.trackId, ctx.fixture.lossyOnlyTrackId] },
    });
    expect(added.json()).toBe(2);
    const addedAgain = await ctx.app.inject({
      method: 'POST',
      url: `/v1/playlists/${playlistId}/tracks`,
      headers: userA.headers,
      payload: { track_ids: [ctx.fixture.trackId] },
    });
    expect(addedAgain.json()).toBe(0);

    const missing = await ctx.app.inject({
      method: 'POST',
      url: `/v1/playlists/${playlistId}/tracks`,
      headers: userA.headers,
      payload: { track_ids: [randomUUID()] },
    });
    expect(missing.statusCode).toBe(404);

    const details = await ctx.app.inject({ url: `/v1/playlists/${playlistId}`, headers: userA.headers });
    expect(details.json().playlist.track_count).toBe(2);
    expect(details.json().playlist.total_duration_ms).toBeGreaterThan(0);
    expect(details.json().tracks).toHaveLength(2);

    const otherGet = await ctx.app.inject({ url: `/v1/playlists/${playlistId}`, headers: userB.headers });
    expect(otherGet.statusCode).toBe(404);
    const otherList = await ctx.app.inject({ url: '/v1/playlists', headers: userB.headers });
    expect(otherList.json()).toEqual([]);

    const localCover = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/playlists/${playlistId}`,
      headers: userA.headers,
      payload: { cover_art_path: 'C:\\Music\\cover.jpg' },
    });
    expect(localCover.statusCode).toBe(400);

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/playlists/${playlistId}`,
      headers: userA.headers,
      payload: { description: 'Late night', cover_art_path: 'https://cdn.example.test/covers/mix.jpg' },
    });
    expect(patched.json().description).toBe('Late night');
    expect(patched.json().name).toBe('Harbor Mix');

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/playlists/${playlistId}/tracks`,
      headers: userA.headers,
      payload: { track_ids: [ctx.fixture.lossyOnlyTrackId] },
    });
    expect(removed.json()).toBe(1);
    const removedAgain = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/playlists/${playlistId}/tracks`,
      headers: userA.headers,
      payload: { track_ids: [ctx.fixture.lossyOnlyTrackId] },
    });
    expect(removedAgain.json()).toBe(0);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/playlists/${playlistId}`,
      headers: userA.headers,
    });
    expect(deleted.json()).toBe(true);
    const after = await ctx.app.inject({ url: `/v1/playlists/${playlistId}`, headers: userA.headers });
    expect(after.statusCode).toBe(404);
    const membership = await ctx.pool.query('SELECT 1 FROM playlist_tracks WHERE playlist_id = $1', [playlistId]);
    expect(membership.rowCount).toBe(0);
  });

  it('reorders only an exact membership list', async () => {
    const user = await register('pl-order@example.com');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: user.headers,
      payload: { name: 'Order' },
    });
    const id = created.json().id as string;
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/playlists/${id}/tracks`,
      headers: user.headers,
      payload: { track_ids: [ctx.fixture.trackId, ctx.fixture.lossyOnlyTrackId] },
    });

    const ok = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/playlists/${id}/order`,
      headers: user.headers,
      payload: { track_ids: [ctx.fixture.lossyOnlyTrackId, ctx.fixture.trackId] },
    });
    expect(ok.statusCode).toBe(204);
    const positions = await ctx.pool.query<{ position: number }>(
      'SELECT position FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position',
      [id],
    );
    expect(positions.rows).toHaveLength(2);
    expect(positions.rows.every((row) => row.position >= 0)).toBe(true);
    expect(new Set(positions.rows.map((row) => row.position)).size).toBe(2);
    const details = await ctx.app.inject({ url: `/v1/playlists/${id}`, headers: user.headers });
    expect(details.json().tracks.map((track: { id: string }) => track.id)).toEqual([
      ctx.fixture.lossyOnlyTrackId,
      ctx.fixture.trackId,
    ]);

    const extra = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/playlists/${id}/order`,
      headers: user.headers,
      payload: { track_ids: [ctx.fixture.trackId] },
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().code).toBe('PLAYLIST_REORDER_MISMATCH');

    const dup = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/playlists/${id}/order`,
      headers: user.headers,
      payload: { track_ids: [ctx.fixture.trackId, ctx.fixture.trackId] },
    });
    expect(dup.statusCode).toBe(400);
  });

  it('assigns unique positions under concurrent append', async () => {
    const user = await register('pl-conc@example.com');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/playlists',
      headers: user.headers,
      payload: { name: 'Concurrent' },
    });
    const id = created.json().id as string;
    const [first, second] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/v1/playlists/${id}/tracks`,
        headers: user.headers,
        payload: { track_ids: [ctx.fixture.trackId] },
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/v1/playlists/${id}/tracks`,
        headers: user.headers,
        payload: { track_ids: [ctx.fixture.lossyOnlyTrackId] },
      }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const positions = await ctx.pool.query<{ position: number }>(
      'SELECT position FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position',
      [id],
    );
    expect(positions.rows).toHaveLength(2);
    expect(new Set(positions.rows.map((row) => row.position)).size).toBe(2);
  });
});

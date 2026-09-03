import { afterEach, expect, it } from 'vitest';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('history integration', handle, (ctx) => {
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

  it('records, lists, paginates, and isolates history', async () => {
    const userA = await register('hist-a@example.com');
    const userB = await register('hist-b@example.com');

    const recorded = await ctx.app.inject({
      method: 'POST',
      url: '/v1/history',
      headers: { ...userA.headers, 'idempotency-key': 'play-1' },
      payload: {
        track_id: ctx.fixture.trackId,
        completed_duration_ms: 120000,
        fully_played: false,
        client_request_id: 'play-1',
      },
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({
      track_id: ctx.fixture.trackId,
      completed_duration_ms: 120000,
      fully_played: false,
    });
    expect(typeof recorded.json().id).toBe('number');
    expect(recorded.json().track.is_favorite).toBe(false);

    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/favorites/tracks/${ctx.fixture.trackId}`,
      headers: userA.headers,
    });
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/library/tracks/${ctx.fixture.trackId}`,
      headers: userA.headers,
    });
    const library = await ctx.app.inject({ url: '/v1/library/tracks', headers: userA.headers });
    expect(library.json()[0].play_count).toBe(1);
    expect(library.json()[0].is_favorite).toBe(true);

    const retry = await ctx.app.inject({
      method: 'POST',
      url: '/v1/history',
      headers: { ...userA.headers, 'idempotency-key': 'play-1' },
      payload: {
        track_id: ctx.fixture.trackId,
        completed_duration_ms: 120000,
        fully_played: false,
        client_request_id: 'play-1',
      },
    });
    expect(retry.json().id).toBe(recorded.json().id);
    const afterRetry = await ctx.app.inject({ url: '/v1/library/tracks', headers: userA.headers });
    expect(afterRetry.json()[0].play_count).toBe(1);

    const mismatch = await ctx.app.inject({
      method: 'POST',
      url: '/v1/history',
      headers: { ...userA.headers, 'idempotency-key': 'aaa' },
      payload: {
        track_id: ctx.fixture.trackId,
        completed_duration_ms: 10,
        fully_played: true,
        client_request_id: 'bbb',
      },
    });
    expect(mismatch.statusCode).toBe(400);

    const tooLong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/history',
      headers: userA.headers,
      payload: {
        track_id: ctx.fixture.trackId,
        completed_duration_ms: 999999,
        fully_played: true,
      },
    });
    expect(tooLong.statusCode).toBe(400);

    const unavailable = await ctx.app.inject({
      method: 'POST',
      url: '/v1/history',
      headers: userA.headers,
      payload: {
        track_id: ctx.fixture.unavailableTrackId,
        completed_duration_ms: 1000,
        fully_played: false,
      },
    });
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json().track).toBeNull();

    const list = await ctx.app.inject({ url: '/v1/history?limit=1&offset=0', headers: userA.headers });
    expect(list.json()).toHaveLength(1);
    const page2 = await ctx.app.inject({ url: '/v1/history?limit=1&offset=1', headers: userA.headers });
    expect(page2.json()).toHaveLength(1);
    expect(page2.json()[0].id).not.toBe(list.json()[0].id);

    const other = await ctx.app.inject({ url: '/v1/history', headers: userB.headers });
    expect(other.json()).toEqual([]);

    const cleared = await ctx.app.inject({ method: 'DELETE', url: '/v1/history', headers: userA.headers });
    expect(cleared.json()).toBeGreaterThanOrEqual(2);
    const afterClear = await ctx.app.inject({ url: '/v1/library/tracks', headers: userA.headers });
    expect(afterClear.json()[0].play_count).toBe(0);
    expect(afterClear.json()[0].last_played).toBeNull();
    expect((await ctx.app.inject({ url: '/v1/history', headers: userA.headers })).json()).toEqual([]);
  });

  it('replays concurrent idempotent writes as a single row', async () => {
    const user = await register('hist-conc@example.com');
    const payload = {
      track_id: ctx.fixture.trackId,
      completed_duration_ms: 1000,
      fully_played: false,
      client_request_id: 'same-key',
    };
    const [a, b] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: '/v1/history',
        headers: { ...user.headers, 'idempotency-key': 'same-key' },
        payload,
      }),
      ctx.app.inject({
        method: 'POST',
        url: '/v1/history',
        headers: { ...user.headers, 'idempotency-key': 'same-key' },
        payload,
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().id).toBe(b.json().id);
    const count = await ctx.pool.query('SELECT COUNT(*)::int AS n FROM play_history');
    expect(count.rows[0]?.n).toBe(1);
  });
});

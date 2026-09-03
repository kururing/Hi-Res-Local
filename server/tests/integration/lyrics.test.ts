import { afterEach, expect, it } from 'vitest';
import { AppError, ErrorCodes } from '../../src/errors/appError.js';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('lyrics integration', handle, (ctx) => {
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

  it('requires auth and only returns unexpired cache on GET', async () => {
    const unauth = await ctx.app.inject({ url: `/v1/tracks/${ctx.fixture.trackId}/lyrics` });
    expect(unauth.statusCode).toBe(401);

    const user = await register('lyr-get@example.com');
    const missing = await ctx.app.inject({
      url: `/v1/tracks/${ctx.fixture.trackId}/lyrics`,
      headers: user.headers,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('LYRICS_NOT_FOUND');
    expect(ctx.lyricsProvider.calls).toHaveLength(0);
  });

  it('resolves through the provider, prefers catalog metadata, and caches positive hits', async () => {
    const user = await register('lyr-res@example.com');
    ctx.lyricsProvider.nextResult = {
      instrumental: false,
      syncedLrc: '[ti:Provider Title]\n[00:01.00]Glass on the harbor\n',
      plainText: 'Glass on the harbor',
      source: 'lrclib',
      title: 'Provider Title',
      artist: 'Provider Artist',
      album: 'Provider Album',
    };

    const resolved = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: user.headers,
      payload: {
        track_id: ctx.fixture.trackId,
        title: 'Client Title',
        artist: 'Client Artist',
        album: 'Client Album',
        duration_seconds: 1,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(ctx.lyricsProvider.calls[0]).toMatchObject({
      title: 'Lanterns Over Water',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
      durationSeconds: 214.5,
    });
    expect(resolved.json()).toMatchObject({
      is_synced: true,
      source: 'lrclib',
      instrumental: false,
    });
    expect(resolved.json().lines[0].timestamp_seconds).toBe(1);

    ctx.lyricsProvider.reset();
    const cachedGet = await ctx.app.inject({
      url: `/v1/tracks/${ctx.fixture.trackId}/lyrics`,
      headers: user.headers,
    });
    expect(cachedGet.statusCode).toBe(200);
    expect(ctx.lyricsProvider.calls).toHaveLength(0);
  });

  it('caches instrumental and genuine not-found, but not provider errors', async () => {
    const user = await register('lyr-neg@example.com');
    ctx.lyricsProvider.nextResult = { instrumental: true, source: 'lrclib' };
    const instrumental = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: user.headers,
      payload: { track_id: ctx.fixture.lossyOnlyTrackId },
    });
    expect(instrumental.json().instrumental).toBe(true);
    const instrumentalRow = await ctx.pool.query<{ status: string }>(
      'SELECT status FROM track_lyrics WHERE track_id = $1',
      [ctx.fixture.lossyOnlyTrackId],
    );
    expect(instrumentalRow.rows[0]?.status).toBe('instrumental');

    ctx.lyricsProvider.reset();
    const cachedInstrumental = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: user.headers,
      payload: { track_id: ctx.fixture.lossyOnlyTrackId },
    });
    expect(cachedInstrumental.statusCode).toBe(200);
    expect(cachedInstrumental.json().instrumental).toBe(true);
    expect(ctx.lyricsProvider.calls).toHaveLength(0);

    ctx.lyricsProvider.reset();
    ctx.lyricsProvider.nextResult = null;
    const notFound = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: user.headers,
      payload: { track_id: ctx.fixture.unavailableTrackId },
    });
    expect(notFound.statusCode).toBe(404);
    expect(ctx.lyricsProvider.calls).toHaveLength(1);
    const notFoundRow = await ctx.pool.query<{ status: string }>(
      'SELECT status FROM track_lyrics WHERE track_id = $1',
      [ctx.fixture.unavailableTrackId],
    );
    expect(notFoundRow.rows[0]?.status).toBe('not_found');

    ctx.lyricsProvider.reset();
    const cachedMiss = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: user.headers,
      payload: { track_id: ctx.fixture.unavailableTrackId },
    });
    expect(cachedMiss.statusCode).toBe(404);
    expect(ctx.lyricsProvider.calls).toHaveLength(0);

    await ctx.pool.query('DELETE FROM track_lyrics WHERE track_id = $1', [ctx.fixture.trackId]);
    ctx.lyricsProvider.reset();
    ctx.lyricsProvider.nextError = new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'down');
    const failed = await ctx.app.inject({
      method: 'POST',
      url: '/v1/lyrics/resolve',
      headers: user.headers,
      payload: { track_id: ctx.fixture.trackId },
    });
    expect(failed.statusCode).toBe(502);
    const cached = await ctx.pool.query('SELECT status FROM track_lyrics WHERE track_id = $1', [ctx.fixture.trackId]);
    expect(cached.rowCount).toBe(0);
  });

  it('serializes concurrent resolve for the same track', async () => {
    const user = await register('lyr-conc@example.com');
    ctx.lyricsProvider.delayMs = 80;
    ctx.lyricsProvider.nextResult = {
      instrumental: false,
      plainText: 'shared',
      source: 'lrclib',
    };
    const [a, b] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: '/v1/lyrics/resolve',
        headers: user.headers,
        payload: { track_id: ctx.fixture.trackId },
      }),
      ctx.app.inject({
        method: 'POST',
        url: '/v1/lyrics/resolve',
        headers: user.headers,
        payload: { track_id: ctx.fixture.trackId },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(ctx.lyricsProvider.calls).toHaveLength(1);
    expect(ctx.lyricsProvider.maxInFlight).toBe(1);
  });
});

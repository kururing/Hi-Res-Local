import { afterEach, expect, it } from 'vitest';
import { describeIntegration, getIntegration, ORIGIN, resetIntegration, uniqueEmail } from './helpers.js';

const handle = await getIntegration();

describeIntegration('streaming integration', handle, (ctx) => {

  afterEach(async () => {
    await resetIntegration();
  });

  async function token(): Promise<string> {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: uniqueEmail('stream'), password: 'correct-horse', display_name: 'Stream' },
    });
    return registered.json().access_token;
  }

  it('rejects unauthenticated stream requests', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.trackId}/stream`,
      headers: { 'content-type': 'application/json' },
      payload: { quality: 'auto' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects unavailable tracks and streams the best original asset for lossy-only tracks', async () => {
    const authorization = `Bearer ${await token()}`;
    const unavailable = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.unavailableTrackId}/stream`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: { quality: 'auto' },
    });
    expect(unavailable.statusCode).toBe(404);
    expect(unavailable.json().code).toBe('STREAM_TRACK_UNAVAILABLE');

    const lossless = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.lossyOnlyTrackId}/stream`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: { quality: 'lossless' },
    });
    expect(lossless.statusCode).toBe(200);
    expect(lossless.json().asset.stream_mode).toBe('maximum');
    expect(JSON.stringify(lossless.json())).not.toContain('storage_key');
  });

  it('always selects the highest-fidelity original asset and returns a short-lived URL', async () => {
    const authorization = `Bearer ${await token()}`;
    ctx.signer.calls.length = 0;

    const cases = ['max', 'lossless', 'high', 'auto'] as const;

    for (const testCase of cases) {
      ctx.signer.calls.length = 0;
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/v1/tracks/${ctx.fixture.trackId}/stream`,
        headers: { authorization, 'content-type': 'application/json' },
        payload: { quality: testCase },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(ctx.signer.calls).toEqual([
        {
          storageKey: ctx.fixture.hiResKey,
          expiresInSeconds: ctx.config.signedUrlTtlSeconds,
          contentType: 'audio/flac',
        },
      ]);
      expect(body.asset.lossless).toBe(true);
      expect(body.asset.mime_type).toBe('audio/flac');
      expect(body.asset.stream_mode).toBe('maximum');
      expect(body.asset.sample_rate_hz).toBeGreaterThan(0);
      expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now() - 1000);
      expect(JSON.stringify(body)).not.toContain('storage_key');
      expect(JSON.stringify(body)).not.toContain(ctx.config.s3.secretAccessKey);
      expect(JSON.stringify(body)).not.toContain(ctx.config.s3.accessKeyId);
      expect(body.url).toContain(encodeURIComponent(ctx.fixture.hiResKey));
    }
  });

  it('ignores client quality and format hints so the original maximum asset is never downgraded', async () => {
    const authorization = `Bearer ${await token()}`;

    const mp3Only = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.trackId}/stream`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: {
        quality: 'max',
        supported_formats: [{ codec: 'mp3', container: 'mp3', mime_type: 'audio/mpeg' }],
      },
    });
    expect(mp3Only.statusCode).toBe(200);
    expect(mp3Only.json().asset.stream_mode).toBe('maximum');
    expect(JSON.stringify(mp3Only.json())).not.toContain('storage_key');

    const losslessOnMp3 = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.trackId}/stream`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: {
        quality: 'lossless',
        supported_formats: [{ codec: 'mp3', container: 'mp3', mime_type: 'audio/mpeg' }],
      },
    });
    expect(losslessOnMp3.statusCode).toBe(200);
    expect(losslessOnMp3.json().asset.stream_mode).toBe('maximum');

    const unsupported = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.trackId}/stream`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: {
        quality: 'auto',
        supported_formats: [{ codec: 'opus', container: 'webm', mime_type: 'audio/webm' }],
      },
    });
    expect(unsupported.statusCode).toBe(200);
    expect(unsupported.json().asset.stream_mode).toBe('maximum');
    expect(JSON.stringify(unsupported.json())).not.toContain('storage_key');
  });

  it('describes the original source without minting a URL', async () => {
    const authorization = `Bearer ${await token()}`;
    ctx.signer.calls.length = 0;
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/tracks/${ctx.fixture.trackId}/source?quality=original`,
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.track_id).toBe(ctx.fixture.trackId);
    expect(body.supports_range).toBe(true);
    expect(body.hires).toBe(true);
    expect(body.stream_mode).toBe('maximum');
    expect(body.file_size).toBeGreaterThan(0);
    expect(ctx.signer.calls).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('storage_key');
  });

  it('accepts original quality as max and redirects artwork without proxying bytes', async () => {
    const authorization = `Bearer ${await token()}`;
    ctx.signer.calls.length = 0;
    const original = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${ctx.fixture.trackId}/stream`,
      headers: { authorization, 'content-type': 'application/json' },
      payload: { quality: 'original' },
    });
    expect(original.statusCode).toBe(200);
    expect(original.json().asset.stream_mode).toBe('maximum');
    expect(original.json().asset.supports_range).toBe(true);
    expect(original.json().asset.hi_res).toBe(true);
    expect(original.json().asset.file_size_bytes).toBeGreaterThan(0);
    expect(ctx.signer.calls[0]?.storageKey).toBe(ctx.fixture.hiResKey);

    const artwork = await ctx.app.inject({
      url: `/v1/tracks/${ctx.fixture.trackId}/artwork`,
      headers: { authorization },
    });
    expect(artwork.statusCode).toBe(302);
    expect(artwork.headers.location).toContain('glass-harbor.jpg');
  });
});

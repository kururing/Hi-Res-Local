import { afterEach, expect, it } from 'vitest';
import {
  describeIntegration,
  getIntegration,
  grantCatalogAdmin,
  ORIGIN,
  resetIntegration,
} from './helpers.js';

const handle = await getIntegration();

describeIntegration('admin publication', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function adminToken() {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: 'publisher@example.test', password: 'correct-horse', display_name: 'Pub' },
    });
    await grantCatalogAdmin(ctx.pool, registered.json().user.id);
    return registered.json().access_token as string;
  }

  it('blocks publish without a ready asset or rights, then streams only after publish', async () => {
    const token = await adminToken();
    const artist = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/artists',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'Northglass' },
    });
    const album = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/albums',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { title: 'Pale Rooms', primary_artist_id: artist.json().id, year: 2025, genre: 'Ambient' },
    });
    const track = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        title: 'Quiet Beam',
        album_id: album.json().id,
        artist_ids: [artist.json().id],
      },
    });
    const trackId = track.json().id as string;

    const blocked = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${trackId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('PUBLISH_NOT_READY');

    await ctx.pool.query(`
      INSERT INTO audio_assets (
        track_id, storage_key, container, codec, sample_rate_hz, channels,
        duration_seconds, file_size_bytes, checksum, is_lossless, available, validation_state
      ) VALUES ($1, $2, 'flac', 'flac', 44100, 2, 12, 1000, $3, TRUE, TRUE, 'ready')
    `, [trackId, `ingestion/audio/${trackId}.flac`, 'a'.repeat(64)]);

    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/catalog/tracks/${trackId}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        rights_holder: 'Synthetic Catalog',
        license_source_ref: 'fixture-public-domain',
        rights_attested: true,
      },
    });

    const published = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${trackId}/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().publication_state).toBe('published');

    const catalog = await ctx.app.inject({
      url: '/v1/catalog/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().some((item: { id: string }) => item.id === trackId)).toBe(true);

    const personalLibrary = await ctx.app.inject({
      url: '/v1/library/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(personalLibrary.json()).toEqual([]);

    const stream = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${trackId}/stream`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { quality: 'auto' },
    });
    expect(stream.statusCode).toBe(200);

    const unpublished = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${trackId}/unpublish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unpublished.json().publication_state).toBe('draft');
    const hidden = await ctx.app.inject({
      url: '/v1/catalog/tracks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(hidden.json().some((item: { id: string }) => item.id === trackId)).toBe(false);
    const blockedStream = await ctx.app.inject({
      method: 'POST',
      url: `/v1/tracks/${trackId}/stream`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { quality: 'auto' },
    });
    expect(blockedStream.statusCode).toBe(404);
  });
});

import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import {
  describeIntegration,
  getIntegration,
  grantCatalogAdmin,
  ORIGIN,
  resetIntegration,
  uniqueEmail,
} from './helpers.js';

const handle = await getIntegration();

describeIntegration('admin uploads', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function admin(email = uniqueEmail('uploader')) {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'correct-horse', display_name: 'Up' },
    });
    const body = registered.json();
    await grantCatalogAdmin(ctx.pool, body.user.id);
    return { token: body.access_token as string, userId: body.user.id as string };
  }

  it('presigns only for admins, generates the object key server-side, and hides it from the client', async () => {
    const { token } = await admin();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { title: 'Draft Signal' },
    });
    expect(created.statusCode).toBe(201);
    const trackId = created.json().id as string;

    const init = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${trackId}/audio-uploads`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'upload-1',
      },
      payload: {
        filename: 'track.flac',
        content_type: 'audio/flac',
        size_bytes: 2048,
        checksum_sha256: 'a'.repeat(64),
      },
    });
    expect(init.statusCode).toBe(201);
    expect(init.json().object_key).toBeNull();
    expect(init.json().method).toBe('PUT');
    expect(init.json().url).toContain('/upload/');

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${trackId}/audio-uploads`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'upload-1',
      },
      payload: {
        filename: 'track.flac',
        content_type: 'audio/flac',
        size_bytes: 2048,
        checksum_sha256: 'a'.repeat(64),
      },
    });
    expect(again.json().upload_id).toBe(init.json().upload_id);

    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${trackId}/audio-uploads`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        filename: 'virus.exe',
        content_type: 'application/octet-stream',
        size_bytes: 10,
        checksum_sha256: 'a'.repeat(64),
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('UPLOAD_INVALID_TYPE');
  });

  it('rejects complete when the object is missing or the checksum/size differs', async () => {
    const { token } = await admin('complete@example.test');
    const track = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { title: 'Need Audio' },
    });
    const hex = createHash('sha256').update('abc').digest('hex');
    const init = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${track.json().id}/audio-uploads`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        filename: 'a.flac',
        content_type: 'audio/flac',
        size_bytes: 3,
        checksum_sha256: hex,
      },
    });
    const uploadId = init.json().upload_id as string;
    const missing = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/uploads/${uploadId}/complete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe('UPLOAD_OBJECT_MISSING');

    const storedKey = (await ctx.pool.query<{ object_key: string }>(
      'SELECT object_key FROM media_uploads WHERE id = $1',
      [uploadId],
    )).rows[0]!.object_key;
    ctx.signer.put(storedKey, Buffer.from('ab'), { checksumSha256: hex });
    const size = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/uploads/${uploadId}/complete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(size.json().code).toBe('UPLOAD_SIZE_MISMATCH');
  });

  it('hashes the stored object when HEAD omits SHA-256', async () => {
    const { token } = await admin('hash-fallback@example.test');
    const track = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { title: 'Hash Fallback' },
    });
    const body = Buffer.from('xyz');
    const hex = createHash('sha256').update(body).digest('hex');
    const init = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${track.json().id}/audio-uploads`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        filename: 'a.flac',
        content_type: 'audio/flac',
        size_bytes: body.length,
        checksum_sha256: hex,
      },
    });
    const uploadId = init.json().upload_id as string;
    const storedKey = (await ctx.pool.query<{ object_key: string }>(
      'SELECT object_key FROM media_uploads WHERE id = $1',
      [uploadId],
    )).rows[0]!.object_key;
    ctx.signer.put(storedKey, body);
    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/uploads/${uploadId}/complete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().checksum_status).toBe('matched');
  });

  it('prevents another admin from completing a foreign upload and supports cancel', async () => {
    const first = await admin('owner@example.test');
    const other = await admin('other@example.test');
    const track = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/tracks',
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      payload: { title: 'Owned' },
    });
    const init = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${track.json().id}/audio-uploads`,
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      payload: {
        filename: 'a.flac',
        content_type: 'audio/flac',
        size_bytes: 8,
        checksum_sha256: 'b'.repeat(64),
      },
    });
    const stolen = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/uploads/${init.json().upload_id}/complete`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(stolen.statusCode).toBe(403);

    const cancelled = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/uploads/${init.json().upload_id}/cancel`,
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');
  });

  it('presigns artist and album artwork for admins only and hides the object key', async () => {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: uniqueEmail('listener'), password: 'correct-horse', display_name: 'Listener' },
    });
    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/artists/${ctx.fixture.artistId}/artwork-uploads`,
      headers: {
        authorization: `Bearer ${registered.json().access_token}`,
        'content-type': 'application/json',
      },
      payload: {
        filename: 'portrait.jpg',
        content_type: 'image/jpeg',
        size_bytes: 2048,
        checksum_sha256: 'c'.repeat(64),
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const { token } = await admin('art@example.test');
    const artistInit = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/artists/${ctx.fixture.artistId}/artwork-uploads`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        filename: 'portrait.jpg',
        content_type: 'image/jpeg',
        size_bytes: 2048,
        checksum_sha256: 'c'.repeat(64),
      },
    });
    expect(artistInit.statusCode).toBe(201);
    expect(artistInit.json().object_key).toBeNull();
    expect(artistInit.json().method).toBe('PUT');

    const albumInit = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/albums/${ctx.fixture.albumId}/artwork-uploads`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        filename: 'cover.jpg',
        content_type: 'image/jpeg',
        size_bytes: 2048,
        checksum_sha256: 'd'.repeat(64),
      },
    });
    expect(albumInit.statusCode).toBe(201);
    expect(albumInit.json().object_key).toBeNull();
  });
});

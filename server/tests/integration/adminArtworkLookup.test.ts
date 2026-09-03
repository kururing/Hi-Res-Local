import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { AdminCatalogService } from '../../src/admin/catalogService.js';
import { FakeRemoteArtworkLookup } from '../../src/ingestion/remoteArtwork.js';
import { UNKNOWN_ARTIST_NAME } from '../../src/admin/placeholders.js';
import { ErrorCodes } from '../../src/errors/appError.js';
import {
  describeIntegration,
  getIntegration,
  ORIGIN,
  resetIntegration,
  uniqueEmail,
} from './helpers.js';

const handle = await getIntegration();

describeIntegration('admin remote artwork lookup', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function seedUser() {
    const userId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash)
       VALUES ($1, $2, $2, 'argon2id-placeholder-hash-value')`,
      [userId, `${userId}@example.test`],
    );
    await ctx.pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Admin')`, [userId]);
    return userId;
  }

  it('stores an iTunes URL on the artist without downloading or creating artwork_assets', async () => {
    const lookup = new FakeRemoteArtworkLookup();
    const service = new AdminCatalogService(ctx.pool, ctx.config, lookup);
    const userId = await seedUser();
    const artistId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO artists (id, name, sort_name) VALUES ($1, 'Ailee', 'ailee')`,
      [artistId],
    );

    const result = await service.lookupArtistArtwork(artistId, userId, 'req-lookup');
    expect(result).toMatchObject({
      id: artistId,
      entity_type: 'artist',
      found: true,
      url: lookup.artistUrl,
    });
    const stored = await ctx.pool.query<{ image_url: string | null }>(
      'SELECT image_url FROM artists WHERE id = $1',
      [artistId],
    );
    expect(stored.rows[0]?.image_url).toBe(lookup.artistUrl);
    const assets = await ctx.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM artwork_assets WHERE entity_id = $1', [artistId]);
    expect(assets.rows[0]?.n).toBe(0);
    expect(lookup.calls).toEqual([{ kind: 'artist', artist: 'Ailee', album: undefined }]);

    lookup.artistUrl = 'https://is1-ssl.mzstatic.com/image/thumb/Features/other.jpg';
    const again = await service.lookupArtistArtwork(artistId, userId, 'req-skip');
    expect(again.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg');
    expect(lookup.calls.filter(item => item.kind === 'artist')).toHaveLength(1);
  });

  it('replaces a stored song cover with the artist portrait link', async () => {
    const lookup = new FakeRemoteArtworkLookup();
    const service = new AdminCatalogService(ctx.pool, ctx.config, lookup);
    const userId = await seedUser();
    const artistId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO artists (id, name, sort_name, image_url)
       VALUES ($1, 'Ailee', 'ailee', 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ab/song.jpg')`,
      [artistId],
    );

    const result = await service.lookupArtistArtwork(artistId, userId, 'req-replace-song');
    expect(result).toMatchObject({ found: true, url: lookup.artistUrl });
    const stored = await ctx.pool.query<{ image_url: string | null }>(
      'SELECT image_url FROM artists WHERE id = $1',
      [artistId],
    );
    expect(stored.rows[0]?.image_url).toBe(lookup.artistUrl);
    expect(lookup.calls).toEqual([{ kind: 'artist', artist: 'Ailee', album: undefined }]);
  });

  it('looks up artist portraits with a representative album title like Desktop', async () => {
    const lookup = new FakeRemoteArtworkLookup();
    const service = new AdminCatalogService(ctx.pool, ctx.config, lookup);
    const userId = await seedUser();
    const artistId = randomUUID();
    const albumId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO artists (id, name, sort_name) VALUES ($1, 'Ailee', 'ailee')`,
      [artistId],
    );
    await ctx.pool.query(
      `INSERT INTO albums (id, title, primary_artist_id) VALUES ($1, 'Invitation', $2)`,
      [albumId, artistId],
    );

    const result = await service.lookupArtistArtwork(artistId, userId, 'req-hint');
    expect(result.found).toBe(true);
    expect(lookup.calls).toEqual([{ kind: 'artist', artist: 'Ailee', album: 'Invitation' }]);
  });

  it('skips unknown placeholder artists and fills missing album covers in a batch', async () => {
    const lookup = new FakeRemoteArtworkLookup();
    const service = new AdminCatalogService(ctx.pool, ctx.config, lookup);
    const userId = await seedUser();
    const unknownId = randomUUID();
    const albumId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO artists (id, name, sort_name, placeholder_kind)
       VALUES ($1, $2, 'unknown', 'unknown_artist')`,
      [unknownId, UNKNOWN_ARTIST_NAME],
    );
    await ctx.pool.query(
      `INSERT INTO albums (id, title, primary_artist_id) VALUES ($1, 'Invitation', $2)`,
      [albumId, ctx.fixture.artistId],
    );

    const batch = await service.lookupMissingArtwork(userId, 'req-batch');
    expect(batch.albums.some(item => item.id === albumId && item.found)).toBe(true);
    expect(batch.artists.some(item => item.id === unknownId)).toBe(false);
    const album = await ctx.pool.query<{ cover_art_url: string | null }>(
      'SELECT cover_art_url FROM albums WHERE id = $1',
      [albumId],
    );
    expect(album.rows[0]?.cover_art_url).toBe(lookup.albumUrl);
  });

  it('replaces an existing album cover only when lookup is forced', async () => {
    const lookup = new FakeRemoteArtworkLookup();
    const service = new AdminCatalogService(ctx.pool, ctx.config, lookup);
    const userId = await seedUser();
    const albumId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO albums (id, title, primary_artist_id, cover_art_url)
       VALUES ($1, 'Invitation', $2, 'https://cdn.example.test/broken.jpg')`,
      [albumId, ctx.fixture.artistId],
    );

    const skipped = await service.lookupAlbumArtwork(albumId, userId, 'req-skip');
    expect(skipped.url).toBe('https://cdn.example.test/broken.jpg');
    expect(lookup.calls.filter(item => item.kind === 'album')).toHaveLength(0);

    const forced = await service.lookupAlbumArtwork(albumId, userId, 'req-force', true);
    expect(forced).toMatchObject({ found: true, url: lookup.albumUrl });
    expect(lookup.calls.filter(item => item.kind === 'album')).toHaveLength(1);
    const stored = await ctx.pool.query<{ cover_art_url: string | null }>(
      'SELECT cover_art_url FROM albums WHERE id = $1',
      [albumId],
    );
    expect(stored.rows[0]?.cover_art_url).toBe(lookup.albumUrl);
  });

  it('rejects artwork lookup for users without the catalog admin role', async () => {
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email: uniqueEmail('lookup'), password: 'correct-horse', display_name: 'User' },
    });
    const token = registered.json().access_token as string;
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/artwork-lookup',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe(ErrorCodes.ADMIN_FORBIDDEN);
  });
});

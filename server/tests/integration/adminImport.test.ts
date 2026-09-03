import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { FakeArtworkProcessor } from '../../src/ingestion/artwork.js';
import { FakeAudioProbe } from '../../src/ingestion/fakeProbe.js';
import { FakeRemoteArtworkLookup } from '../../src/ingestion/remoteArtwork.js';
import { IngestionWorker } from '../../src/ingestion/worker.js';
import { emptyMappedTags } from '../../src/ingestion/tags.js';
import {
  describeIntegration,
  getIntegration,
  grantCatalogAdmin,
  ORIGIN,
  resetIntegration,
  uniqueEmail,
} from './helpers.js';

const handle = await getIntegration();

describeIntegration('admin imports', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function register(prefix: string, admin = true) {
    const email = uniqueEmail(prefix);
    const registered = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { email, password: 'correct-horse', display_name: prefix },
    });
    const body = registered.json();
    if (admin) await grantCatalogAdmin(ctx.pool, body.user.id);
    return { token: body.access_token as string, userId: body.user.id as string };
  }

  function auth(token: string, extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: ORIGIN, ...extra };
  }

  function probeWithTags() {
    return new FakeAudioProbe({
      container: 'wav',
      codec: 'pcm',
      durationSeconds: 3,
      sampleRateHz: 44_100,
      bitDepth: 16,
      channels: 2,
      bitrateKbps: 1411,
      isLossless: true,
      hiRes: false,
      dsd: false,
      channelLayout: 'stereo',
      hasAudioStream: true,
      hasAttachedPicture: false,
      tags: {
        ...emptyMappedTags(),
        title: 'Import Signal',
        artist: 'Import Artist',
        albumArtist: 'Import Artist',
        album: 'Import Album',
        genre: 'Electronic',
        date: '2026',
        year: 2026,
        track: 1,
        trackTotal: 8,
        disc: 1,
        discTotal: 1,
        isrc: 'USAT21702278',
        lyrics: {
          kind: 'plain',
          parsed: { offset: 0, lines: [], is_synced: false, plain_text: 'Hello from the file' },
          synced_lrc: null,
          plain_text: 'Hello from the file',
        },
      },
    });
  }

  async function putObject(uploadId: string, body: Buffer, checksum: string) {
    const row = await ctx.pool.query<{ object_key: string; bucket: string }>(
      'SELECT object_key, bucket FROM media_uploads WHERE id = $1',
      [uploadId],
    );
    ctx.signer.put(row.rows[0]!.object_key, body, {
      checksumSha256: checksum,
      contentType: 'audio/wav',
      bucket: row.rows[0]!.bucket,
    });
    return row.rows[0]!.object_key;
  }

  async function createAndProbe(
    token: string,
    body: Buffer,
    filename = 'import.wav',
    probe = probeWithTags(),
  ) {
    const checksum = createHash('sha256').update(body).digest('hex');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: auth(token, { 'idempotency-key': `imp-${randomUUID()}` }),
      payload: {
        filename,
        content_type: 'audio/wav',
        size_bytes: body.length,
        checksum_sha256: checksum,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().upload.object_key).toBeNull();
    expect(JSON.stringify(created.json())).not.toContain('storage_key');
    const importId = created.json().import.id as string;
    const uploadId = created.json().upload.upload_id as string;
    await putObject(uploadId, body, checksum);
    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${importId}/complete`,
      headers: auth(token),
    });
    expect(complete.statusCode).toBe(200);
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe,
      artwork: new FakeArtworkProcessor(),
      remoteArtwork: new FakeRemoteArtworkLookup(),
      workerId: `import-${importId.slice(0, 8)}`,
    });
    expect(await worker.processOne()).toBe(true);
    const viewed = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/imports/${importId}`,
      headers: auth(token),
    });
    return { importId, uploadId, checksum, view: viewed.json() };
  }

  it('rejects a regular user and hides object keys from admins', async () => {
    const user = await register('user', false);
    const admin = await register('admin');
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: auth(user.token),
      payload: {
        filename: 'a.wav',
        content_type: 'audio/wav',
        size_bytes: 16,
        checksum_sha256: 'a'.repeat(64),
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('ADMIN_FORBIDDEN');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: auth(admin.token, { 'idempotency-key': 'same-import' }),
      payload: {
        filename: 'a.wav',
        content_type: 'audio/wav',
        size_bytes: 16,
        checksum_sha256: 'b'.repeat(64),
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().upload.object_key).toBeNull();
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: auth(admin.token, { 'idempotency-key': 'same-import' }),
      payload: {
        filename: 'a.wav',
        content_type: 'audio/wav',
        size_bytes: 16,
        checksum_sha256: 'b'.repeat(64),
      },
    });
    expect(again.json().import.id).toBe(created.json().import.id);
    const conflict = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: auth(admin.token, { 'idempotency-key': 'same-import' }),
      payload: {
        filename: 'a.wav',
        content_type: 'audio/wav',
        size_bytes: 32,
        checksum_sha256: 'c'.repeat(64),
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('UPLOAD_CONFLICT');
  });

  it('probes tags then auto-publishes without leaking keys', async () => {
    const { token } = await register('publisher');
    const body = Buffer.from('import-audio-bytes');
    const { importId, view } = await createAndProbe(token, body);
    expect(['published', 'duplicate']).toContain(view.status);
    expect(view.effective.title).toBe('Import Signal');
    expect(view.effective.artist).toBe('Import Artist');
    expect(view.effective.album).toBe('Import Album');
    expect(JSON.stringify(view)).not.toMatch(/ingestion\/audio|object_key|storage_key/);

    const listed = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/imports',
      headers: auth(token),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().some((row: { id: string }) => row.id === importId)).toBe(true);

    const trackId = view.committed_track_id as string;
    expect(trackId).toBeTruthy();

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${importId}/commit`,
      headers: auth(token),
      payload: {},
    });
    expect(again.json().committed_track_id).toBe(trackId);

    const catalog = await ctx.app.inject({
      method: 'GET',
      url: `/v1/catalog/tracks/${trackId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().title).toBe('Import Signal');
    expect(catalog.json().cover_art_path).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg');
    expect(catalog.json().artist_image_url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg');
    expect(JSON.stringify(catalog.json())).not.toContain('storage_key');

    const search = await ctx.app.inject({
      method: 'GET',
      url: '/v1/catalog/search?q=Import%20Signal',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).toContain(trackId);

    const lyrics = await ctx.pool.query<{ provider: string; plain_text: string }>(
      'SELECT provider, plain_text FROM track_lyrics WHERE track_id = $1',
      [trackId],
    );
    expect(lyrics.rows[0]?.provider).toBe('embedded');
    expect(lyrics.rows[0]?.plain_text).toBe('Hello from the file');

    const assets = await ctx.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audio_assets WHERE track_id = $1 AND available = TRUE',
      [trackId],
    );
    expect(assets.rows[0]?.n).toBe(1);
  });

  it('cancels an unfinished import and reuses an existing checksum without duplicating assets', async () => {
    const first = await register('owner');
    const second = await register('other');
    const body = Buffer.from('shared-import-bytes');
    const { checksum, view } = await createAndProbe(first.token, body, 'first.wav');
    expect(view.status).toBe('published');
    const trackId = view.committed_track_id as string;
    expect(trackId).toBeTruthy();

    const other = await createAndProbe(second.token, body, 'second.wav');
    expect(other.view.status).toBe('duplicate');
    expect(other.view.committed_track_id).toBe(trackId);
    const assetCount = await ctx.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audio_assets WHERE checksum = $1 AND available = TRUE',
      [checksum],
    );
    expect(assetCount.rows[0]?.n).toBe(1);

    const cancellable = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports',
      headers: auth(first.token),
      payload: {
        filename: 'cancel.wav',
        content_type: 'audio/wav',
        size_bytes: 8,
        checksum_sha256: 'd'.repeat(64),
      },
    });
    const cancel = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/imports/${cancellable.json().import.id}/cancel`,
      headers: auth(first.token),
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe('cancelled');
  });

  it('reuses the oldest artist when the normalized name has duplicates, then publishes', async () => {
    const { token } = await register('ambig');
    const older = randomUUID();
    await ctx.pool.query(`INSERT INTO artists (id, name, sort_name, created_at) VALUES ($1, 'Twin Name', 'twin name', '2020-01-01T00:00:00Z')`, [older]);
    await ctx.pool.query(`INSERT INTO artists (id, name, sort_name, created_at) VALUES ($1, 'Twin Name', 'twin name', '2024-01-01T00:00:00Z')`, [randomUUID()]);
    const body = Buffer.from('ambiguous-import');
    const { view } = await createAndProbe(
      token,
      body,
      'twin.wav',
      new FakeAudioProbe({
        container: 'wav',
        codec: 'pcm',
        durationSeconds: 1,
        sampleRateHz: 44_100,
        bitDepth: 16,
        channels: 2,
        bitrateKbps: 1411,
        isLossless: true,
        hiRes: false,
        dsd: false,
        channelLayout: 'stereo',
        hasAudioStream: true,
        tags: {
          title: 'Twin Track',
          artist: 'Twin Name',
          albumArtist: 'Twin Name',
          album: 'Twin Album',
        },
      }),
    );
    expect(view.status).toBe('published');
    expect(view.committed_artist_id).toBe(older);
    const linked = await ctx.pool.query<{ artist_id: string }>(
      'SELECT artist_id FROM track_artists WHERE track_id = $1 ORDER BY position, artist_id',
      [view.committed_track_id],
    );
    expect(linked.rows.map((row) => row.artist_id)).toEqual([older]);
  });

  it('scans unlinked audio objects and skips objects that are already linked', async () => {
    const { token } = await register('scanner');
    const body = Buffer.from('orphan-import-bytes');
    const checksum = createHash('sha256').update(body).digest('hex');
    const key = `ingestion/audio/${randomUUID()}.wav`;
    ctx.signer.put(key, body, { checksumSha256: checksum, contentType: 'audio/wav' });

    const scanned = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports/reconcile',
      headers: auth(token),
    });
    expect(scanned.statusCode).toBe(200);
    expect(scanned.json().enqueued).toBeGreaterThanOrEqual(1);
    const importId = (await ctx.pool.query<{ id: string }>(
      'SELECT id FROM audio_imports WHERE object_key = $1',
      [key],
    )).rows[0]?.id;
    expect(importId).toBeTruthy();
    expect(JSON.stringify(scanned.json())).not.toContain('storage_key');

    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: probeWithTags(),
      artwork: new FakeArtworkProcessor(),
      workerId: 'reconcile',
    });
    expect(await worker.processOne()).toBe(true);
    const viewed = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/imports/${importId}`,
      headers: auth(token),
    });
    expect(['published', 'duplicate']).toContain(viewed.json().status);

    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/imports/reconcile',
      headers: auth(token),
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().enqueued).toBe(0);
  });
});

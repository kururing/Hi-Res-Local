import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { FakeArtworkProcessor } from '../../src/ingestion/artwork.js';
import { FakeAudioProbe } from '../../src/ingestion/fakeProbe.js';
import { ProbeError } from '../../src/ingestion/probe.js';
import { IngestionJobRepository } from '../../src/ingestion/jobRepository.js';
import { IngestionWorker } from '../../src/ingestion/worker.js';
import { UploadRepository } from '../../src/admin/uploadRepository.js';
import { FakeRemoteArtworkLookup } from '../../src/ingestion/remoteArtwork.js';
import { withTransaction } from '../../src/db/types.js';
import { createSyntheticFlacWithPicture } from '../../src/media/synthetic.js';
import { describeIntegration, getIntegration, resetIntegration } from './helpers.js';

const handle = await getIntegration();

describeIntegration('ingestion worker', handle, (ctx) => {
  afterEach(async () => {
    await resetIntegration();
  });

  async function enqueueAudio(status: 'pending' | 'failed' = 'pending') {
    const userId = randomUUID();
    const trackId = randomUUID();
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const body = Buffer.from('synthetic-audio');
    const checksum = createHash('sha256').update(body).digest('hex');
    await ctx.pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash)
       VALUES ($1, $2, $2, 'argon2id-placeholder-hash-value')`,
      [userId, `${userId}@example.test`],
    );
    await ctx.pool.query(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Worker')`,
      [userId],
    );
    await ctx.pool.query(
      `INSERT INTO tracks (id, title, duration_seconds, available, publication_state)
       VALUES ($1, 'Probe Me', 0, FALSE, 'draft')`,
      [trackId],
    );
    await ctx.pool.query(`
      INSERT INTO media_uploads (
        id, owner_id, media_type, entity_type, entity_id, object_key, bucket,
        expected_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        status, presign_expires_at
      ) VALUES (
        $1,$2,'audio','track',$3,$4,'nghenhacpromax','a.flac','audio/flac',$5,$6,'uploaded', timezone('utc', now())
      )
    `, [uploadId, userId, trackId, `ingestion/audio/${uploadId}.flac`, body.length, checksum]);
    await ctx.pool.query(`
      INSERT INTO ingestion_jobs (id, upload_id, job_type, status)
      VALUES ($1, $2, 'audio_probe', $3)
    `, [jobId, uploadId, status]);
    ctx.signer.put(`ingestion/audio/${uploadId}.flac`, body, { checksumSha256: checksum });
    return { trackId, uploadId, jobId, checksum };
  }

  it('does not let two workers claim the same job', async () => {
    await enqueueAudio();
    const first = await withTransaction(ctx.pool, (trx) => new IngestionJobRepository(trx).claimNext('w1'));
    const second = await withTransaction(ctx.pool, (trx) => new IngestionJobRepository(trx).claimNext('w2'));
    expect(first?.job.id).toBeTruthy();
    expect(second).toBeNull();
  });

  it('fences terminal updates to the worker that owns the live lease', async () => {
    const seeded = await enqueueAudio();
    const claimed = await withTransaction(ctx.pool, (trx) => new IngestionJobRepository(trx).claimNext('lease-owner'));
    expect(claimed?.job.id).toBe(seeded.jobId);

    const jobs = new IngestionJobRepository(ctx.pool);
    expect(await jobs.markReady(seeded.jobId, 'stale-worker')).toBe(false);
    expect(await jobs.markFailed(seeded.jobId, 'stale-worker', 'STALE', 'stale', null)).toBe(false);
    expect(await jobs.renewLease(seeded.jobId, 'lease-owner')).toBe(true);
    expect(await jobs.markReady(seeded.jobId, 'lease-owner')).toBe(true);
  });

  it('does not revive a job after cancellation', async () => {
    const seeded = await enqueueAudio();
    const claimed = await withTransaction(ctx.pool, (trx) => new IngestionJobRepository(trx).claimNext('cancelled-owner'));
    expect(claimed?.job.id).toBe(seeded.jobId);

    await withTransaction(ctx.pool, async (trx) => {
      const uploads = new UploadRepository(trx);
      await uploads.cancelJobs(seeded.uploadId);
      await uploads.markCancelled(seeded.uploadId);
    });

    const jobs = new IngestionJobRepository(ctx.pool);
    expect(await jobs.markReady(seeded.jobId, 'cancelled-owner')).toBe(false);
    expect(await jobs.markFailed(seeded.jobId, 'cancelled-owner', 'LATE', 'late', null)).toBe(false);
    const row = await ctx.pool.query<{ status: string }>('SELECT status FROM ingestion_jobs WHERE id = $1', [seeded.jobId]);
    expect(row.rows[0]?.status).toBe('cancelled');
  });

  it('marks an asset available only after a successful probe and verifies checksum', async () => {
    const seeded = await enqueueAudio();
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: new FakeAudioProbe({
        container: 'flac',
        codec: 'flac',
        durationSeconds: 12,
        sampleRateHz: 48_000,
        bitDepth: 24,
        channels: 2,
        bitrateKbps: 1400,
        isLossless: true,
        hiRes: false,
        dsd: false,
        channelLayout: 'stereo',
        hasAudioStream: true,
        tags: {
          title: null, artist: null, albumArtist: null, album: null, genre: null,
          date: null, year: null, track: null, trackTotal: null, disc: null,
          discTotal: null, composer: null, comment: null,
        },
      }),
      artwork: new FakeArtworkProcessor(),
      workerId: 'w-success',
    });
    expect(await worker.processOne()).toBe(true);
    const asset = await ctx.pool.query<{ available: boolean; validation_state: string; checksum: string }>(
      'SELECT available, validation_state, checksum FROM audio_assets WHERE track_id = $1',
      [seeded.trackId],
    );
    expect(asset.rows[0]).toMatchObject({
      available: true,
      validation_state: 'ready',
      checksum: seeded.checksum,
    });
  });

  it('fails permanently on an invalid file and does not retry', async () => {
    const seeded = await enqueueAudio();
    const probe = new FakeAudioProbe();
    probe.next = new ProbeError('PROBE_NO_AUDIO', 'No audio stream was found.');
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe,
      artwork: new FakeArtworkProcessor(),
      workerId: 'w-fail',
    });
    await worker.processOne();
    const job = await ctx.pool.query<{ status: string; last_error_code: string }>(
      'SELECT status, last_error_code FROM ingestion_jobs WHERE id = $1',
      [seeded.jobId],
    );
    expect(job.rows[0]).toMatchObject({ status: 'failed', last_error_code: 'PROBE_NO_AUDIO' });
  });

  it('probes an import upload and auto-publishes catalog rows', async () => {
    const userId = randomUUID();
    const importId = randomUUID();
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const body = Buffer.from('import-probe-bytes');
    const checksum = createHash('sha256').update(body).digest('hex');
    await ctx.pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash)
       VALUES ($1, $2, $2, 'argon2id-placeholder-hash-value')`,
      [userId, `${userId}@example.test`],
    );
    await ctx.pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Importer')`, [userId]);
    const objectKey = `ingestion/audio/${uploadId}.wav`;
    await ctx.pool.query(`
      INSERT INTO audio_imports (
        id, owner_id, original_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        bucket, object_key, status, expires_at
      ) VALUES ($1,$2,'import.wav','audio/wav',$3,$4,'nghenhacpromax',$5,'probing', timezone('utc', now()) + interval '15 minutes')
    `, [importId, userId, body.length, checksum, objectKey]);
    await ctx.pool.query(`
      INSERT INTO media_uploads (
        id, owner_id, media_type, entity_type, entity_id, object_key, bucket,
        expected_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        status, presign_expires_at
      ) VALUES (
        $1,$2,'audio','import',$3,$4,'nghenhacpromax','import.wav','audio/wav',$5,$6,'uploaded', timezone('utc', now())
      )
    `, [uploadId, userId, importId, objectKey, body.length, checksum]);
    await ctx.pool.query(`UPDATE audio_imports SET upload_id = $2 WHERE id = $1`, [importId, uploadId]);
    await ctx.pool.query(`INSERT INTO ingestion_jobs (id, upload_id, job_type, status) VALUES ($1,$2,'audio_probe','pending')`, [jobId, uploadId]);
    ctx.signer.put(objectKey, body, { checksumSha256: checksum });

    const beforeTracks = await ctx.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM tracks');
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: new FakeAudioProbe({
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
        tags: {
          title: 'Worker Import',
          artist: 'Worker Artist',
          albumArtist: 'Worker Artist',
          album: 'Worker Album',
          genre: null, date: null, year: null, track: null, trackTotal: null,
          disc: null, discTotal: null, composer: null, comment: null,
        },
      }),
      artwork: new FakeArtworkProcessor(),
      remoteArtwork: new FakeRemoteArtworkLookup(),
      workerId: 'w-import',
    });
    expect(await worker.processOne()).toBe(true);
    const afterTracks = await ctx.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM tracks');
    expect(afterTracks.rows[0]?.n).toBeGreaterThan(beforeTracks.rows[0]?.n ?? 0);
    const assets = await ctx.pool.query(`SELECT count(*)::int AS n FROM audio_assets WHERE checksum = $1`, [checksum]);
    expect(assets.rows[0]?.n).toBe(1);
    const imported = await ctx.pool.query<{ status: string; detected: { title?: string } }>(
      'SELECT status, detected_metadata_json AS detected FROM audio_imports WHERE id = $1',
      [importId],
    );
    expect(imported.rows[0]?.status).toBe('published');
    expect(imported.rows[0]?.detected.title).toBe('Worker Import');
    const album = await ctx.pool.query<{ cover_art_url: string | null }>(
      `SELECT cover_art_url FROM albums WHERE title = 'Worker Album'`,
    );
    const artist = await ctx.pool.query<{ image_url: string | null }>(
      `SELECT image_url FROM artists WHERE name = 'Worker Artist'`,
    );
    expect(album.rows[0]?.cover_art_url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg');
    expect(artist.rows[0]?.image_url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg');
    const artworkAssets = await ctx.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM artwork_assets');
    expect(artworkAssets.rows[0]?.n).toBe(0);
  });

  it('does not publish embedded cover art from audio metadata onto the album', async () => {
    const userId = randomUUID();
    const importId = randomUUID();
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const body = createSyntheticFlacWithPicture();
    const checksum = createHash('sha256').update(body).digest('hex');
    await ctx.pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash)
       VALUES ($1, $2, $2, 'argon2id-placeholder-hash-value')`,
      [userId, `${userId}@example.test`],
    );
    await ctx.pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Cover Importer')`, [userId]);
    const objectKey = `ingestion/audio/${uploadId}.flac`;
    await ctx.pool.query(`
      INSERT INTO audio_imports (
        id, owner_id, original_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        bucket, object_key, status, expires_at
      ) VALUES ($1,$2,'cover.flac','audio/flac',$3,$4,'nghenhacpromax',$5,'probing', timezone('utc', now()) + interval '15 minutes')
    `, [importId, userId, body.length, checksum, objectKey]);
    await ctx.pool.query(`
      INSERT INTO media_uploads (
        id, owner_id, media_type, entity_type, entity_id, object_key, bucket,
        expected_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        status, presign_expires_at
      ) VALUES (
        $1,$2,'audio','import',$3,$4,'nghenhacpromax','cover.flac','audio/flac',$5,$6,'uploaded', timezone('utc', now())
      )
    `, [uploadId, userId, importId, objectKey, body.length, checksum]);
    await ctx.pool.query(`UPDATE audio_imports SET upload_id = $2 WHERE id = $1`, [importId, uploadId]);
    await ctx.pool.query(`INSERT INTO ingestion_jobs (id, upload_id, job_type, status) VALUES ($1,$2,'audio_probe','pending')`, [jobId, uploadId]);
    ctx.signer.put(objectKey, body, { checksumSha256: checksum });

    const artwork = new FakeArtworkProcessor();
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: new FakeAudioProbe({
        container: 'flac',
        codec: 'flac',
        durationSeconds: 4,
        sampleRateHz: 44_100,
        bitDepth: 16,
        channels: 2,
        bitrateKbps: 900,
        isLossless: true,
        hiRes: false,
        dsd: false,
        channelLayout: 'stereo',
        hasAudioStream: true,
        hasAttachedPicture: true,
        tags: {
          title: 'Cover Track',
          artist: 'Cover Artist',
          albumArtist: 'Cover Artist',
          album: 'Cover Album',
          genre: null, date: null, year: null, track: null, trackTotal: null,
          disc: null, discTotal: null, composer: null, comment: null,
        },
      }),
      artwork,
      workerId: 'w-cover',
    });
    expect(await worker.processOne()).toBe(true);
    expect(artwork.lastInput).toBeNull();
    const imported = await ctx.pool.query<{
      status: string;
      detected: { artwork_public_url?: string | null; has_attached_picture?: boolean };
    }>(
      'SELECT status, detected_metadata_json AS detected FROM audio_imports WHERE id = $1',
      [importId],
    );
    expect(imported.rows[0]?.status).toBe('published');
    expect(imported.rows[0]?.detected.has_attached_picture).toBe(true);
    expect(imported.rows[0]?.detected.artwork_public_url ?? null).toBeNull();
    const album = await ctx.pool.query<{ cover_art_url: string | null }>(
      `SELECT cover_art_url FROM albums WHERE title = 'Cover Album'`,
    );
    expect(album.rows[0]?.cover_art_url).toBeNull();
  });

  it('prefers an iTunes album link over embedded file artwork', async () => {
    const userId = randomUUID();
    const importId = randomUUID();
    const uploadId = randomUUID();
    const jobId = randomUUID();
    const body = createSyntheticFlacWithPicture();
    const checksum = createHash('sha256').update(body).digest('hex');
    await ctx.pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash)
       VALUES ($1, $2, $2, 'argon2id-placeholder-hash-value')`,
      [userId, `${userId}@example.test`],
    );
    await ctx.pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Itunes Cover')`, [userId]);
    const objectKey = `ingestion/audio/${uploadId}.flac`;
    await ctx.pool.query(`
      INSERT INTO audio_imports (
        id, owner_id, original_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        bucket, object_key, status, expires_at
      ) VALUES ($1,$2,'itunes.flac','audio/flac',$3,$4,'nghenhacpromax',$5,'probing', timezone('utc', now()) + interval '15 minutes')
    `, [importId, userId, body.length, checksum, objectKey]);
    await ctx.pool.query(`
      INSERT INTO media_uploads (
        id, owner_id, media_type, entity_type, entity_id, object_key, bucket,
        expected_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
        status, presign_expires_at
      ) VALUES (
        $1,$2,'audio','import',$3,$4,'nghenhacpromax','itunes.flac','audio/flac',$5,$6,'uploaded', timezone('utc', now())
      )
    `, [uploadId, userId, importId, objectKey, body.length, checksum]);
    await ctx.pool.query(`UPDATE audio_imports SET upload_id = $2 WHERE id = $1`, [importId, uploadId]);
    await ctx.pool.query(`INSERT INTO ingestion_jobs (id, upload_id, job_type, status) VALUES ($1,$2,'audio_probe','pending')`, [jobId, uploadId]);
    ctx.signer.put(objectKey, body, { checksumSha256: checksum });

    const artwork = new FakeArtworkProcessor();
    const remoteArtwork = new FakeRemoteArtworkLookup();
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: new FakeAudioProbe({
        container: 'flac',
        codec: 'flac',
        durationSeconds: 4,
        sampleRateHz: 44_100,
        bitDepth: 16,
        channels: 2,
        bitrateKbps: 900,
        isLossless: true,
        hiRes: false,
        dsd: false,
        channelLayout: 'stereo',
        hasAudioStream: true,
        hasAttachedPicture: true,
        tags: {
          title: 'Itunes Track',
          artist: 'Itunes Artist',
          albumArtist: 'Itunes Artist',
          album: 'Itunes Album',
          genre: null, date: null, year: null, track: null, trackTotal: null,
          disc: null, discTotal: null, composer: null, comment: null,
        },
      }),
      artwork,
      remoteArtwork,
      workerId: 'w-itunes-cover',
    });
    expect(await worker.processOne()).toBe(true);
    expect(artwork.lastInput).toBeNull();
    const album = await ctx.pool.query<{ cover_art_url: string | null }>(
      `SELECT cover_art_url FROM albums WHERE title = 'Itunes Album'`,
    );
    expect(album.rows[0]?.cover_art_url).toBe(remoteArtwork.albumUrl);
    const assets = await ctx.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM artwork_assets WHERE entity_id = (SELECT id FROM albums WHERE title = $1)',
      ['Itunes Album'],
    );
    expect(assets.rows[0]?.n).toBe(0);
  });

  it('reclaims probing jobs whose worker lease has expired', async () => {
    const seeded = await enqueueAudio();
    await ctx.pool.query(`
      UPDATE ingestion_jobs
      SET status = 'probing', locked_by = 'dead-worker',
          locked_at = timezone('utc', now()) - interval '10 minutes'
      WHERE id = $1
    `, [seeded.jobId]);
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: { ...ctx.config, workerLeaseSeconds: 30 },
      signer: ctx.signer,
      probe: new FakeAudioProbe(),
      artwork: new FakeArtworkProcessor(),
      workerId: 'w-reclaim',
    });
    expect(await worker.reclaimExpiredLeases()).toBeGreaterThan(0);
    const row = await ctx.pool.query<{ status: string; locked_by: string | null }>(
      'SELECT status, locked_by FROM ingestion_jobs WHERE id = $1',
      [seeded.jobId],
    );
    expect(row.rows[0]).toMatchObject({ status: 'pending', locked_by: null });
  });

  it('runs --once for a configured batch, reports counts, and releases leases', async () => {
    await enqueueAudio();
    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: new FakeAudioProbe(),
      artwork: new FakeArtworkProcessor(),
      workerId: 'w-once',
    });
    const stats = await worker.runOnce(1);
    expect(stats).toMatchObject({ claimed: 1, ready: 1, failed: 0, retried: 0, infrastructureError: false });
    const locked = await ctx.pool.query(`SELECT count(*)::int AS n FROM ingestion_jobs WHERE locked_by = 'w-once'`);
    expect(locked.rows[0]?.n).toBe(0);
    expect(await worker.processOne()).toBe(false);
  });

  it('denormalizes processed artwork onto album and artist catalog rows', async () => {
    const userId = randomUUID();
    const body = Buffer.from('fake-portrait');
    const checksum = createHash('sha256').update(body).digest('hex');
    await ctx.pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash)
       VALUES ($1, $2, $2, 'argon2id-placeholder-hash-value')`,
      [userId, `${userId}@example.test`],
    );
    await ctx.pool.query(
      `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Art')`,
      [userId],
    );

    const enqueue = async (entityType: 'album' | 'artist', entityId: string) => {
      const uploadId = randomUUID();
      const jobId = randomUUID();
      const objectKey = `ingestion/artwork/${uploadId}.png`;
      await ctx.pool.query(`
        INSERT INTO media_uploads (
          id, owner_id, media_type, entity_type, entity_id, object_key, bucket,
          expected_filename, expected_mime, expected_size_bytes, expected_checksum_sha256,
          status, presign_expires_at
        ) VALUES (
          $1,$2,'artwork',$3,$4,$5,'nghenhacpromax-artwork','cover.png','image/png',$6,$7,'uploaded', timezone('utc', now())
        )
      `, [uploadId, userId, entityType, entityId, objectKey, body.length, checksum]);
      await ctx.pool.query(
        `INSERT INTO ingestion_jobs (id, upload_id, job_type, status) VALUES ($1,$2,'artwork_process','pending')`,
        [jobId, uploadId],
      );
      ctx.signer.put(objectKey, body, { checksumSha256: checksum, bucket: 'nghenhacpromax-artwork' });
    };

    await enqueue('artist', ctx.fixture.artistId);
    await enqueue('album', ctx.fixture.albumId);

    const worker = new IngestionWorker({
      pool: ctx.pool,
      config: ctx.config,
      signer: ctx.signer,
      probe: new FakeAudioProbe(),
      artwork: new FakeArtworkProcessor(),
      workerId: 'w-art',
    });
    expect(await worker.processOne()).toBe(true);
    expect(await worker.processOne()).toBe(true);

    const artist = await ctx.pool.query<{ image_url: string | null }>(
      'SELECT image_url FROM artists WHERE id = $1',
      [ctx.fixture.artistId],
    );
    const album = await ctx.pool.query<{ cover_art_url: string | null }>(
      'SELECT cover_art_url FROM albums WHERE id = $1',
      [ctx.fixture.albumId],
    );
    expect(artist.rows[0]?.image_url).toMatch(/ingestion\/artwork\//);
    expect(album.rows[0]?.cover_art_url).toMatch(/ingestion\/artwork\//);
  });
});

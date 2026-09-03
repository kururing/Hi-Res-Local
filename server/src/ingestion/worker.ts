import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { toNumber, withTransaction, type Queryable } from '../db/types.js';
import { writeAdminAudit } from '../admin/audit.js';
import { AdminCatalogRepository } from '../admin/catalogRepository.js';
import { requireObjectStore, type ObjectStorageSigner } from '../storage/signer.js';
import { audioMimeType } from '../streaming/mime.js';
import { ARTWORK_CACHE_CONTROL } from '../http/cacheControl.js';
import { defaultMetrics, type MetricsRegistry } from '../observability/metrics.js';
import { redactSignedUrl } from '../logging/redact.js';
import type { ArtworkProcessor } from './artwork.js';
import { ArtworkError } from './artwork.js';
import { IngestionJobRepository, type ClaimedJob } from './jobRepository.js';
import { ProbeError, type AudioProbe } from './probe.js';
import { classifyAudio } from './classification.js';
import { AudioImportRepository } from '../admin/importRepository.js';
import { UploadRepository } from '../admin/uploadRepository.js';
import { autoPublishImport } from '../admin/autoPublish.js';
import { fillCatalogRemoteArtwork } from '../admin/fillRemoteArtwork.js';
import { buildDetectedMetadata } from '../admin/importMetadata.js';
import { buildImportMatch } from '../admin/matching.js';
import { audioTempExtension } from '../admin/mediaTypes.js';
import type { RemoteArtworkLookup } from './remoteArtwork.js';

export interface IngestionWorkerOptions {
  pool: Pool;
  config: AppConfig;
  signer: ObjectStorageSigner;
  probe: AudioProbe;
  artwork: ArtworkProcessor;
  remoteArtwork?: RemoteArtworkLookup;
  workerId?: string;
  metrics?: MetricsRegistry;
  log?: (fields: Record<string, unknown>, message: string) => void;
}

export interface WorkerOnceStats {
  claimed: number;
  ready: number;
  failed: number;
  retried: number;
  cancelled: number;
  infrastructureError: boolean;
}

class JobLeaseLostError extends Error {
  constructor() {
    super('The ingestion job was cancelled or its lease is no longer owned by this worker.');
    this.name = 'JobLeaseLostError';
  }
}

const TRANSIENT_CODES = new Set([
  'PROBE_TIMEOUT',
  'PROBE_SPAWN_FAILED',
  'OBJECT_DOWNLOAD_FAILED',
]);

const INFRASTRUCTURE_CODES = new Set([
  'PROBE_SPAWN_FAILED',
  'OBJECT_DOWNLOAD_FAILED',
  'NNPM_PROBE_MISSING',
]);

export class IngestionWorker {
  private readonly workerId: string;
  private readonly store: ReturnType<typeof requireObjectStore>;
  private readonly metrics: MetricsRegistry;
  lastInfrastructureError = false;

  constructor(private readonly options: IngestionWorkerOptions) {
    this.workerId = options.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.store = requireObjectStore(options.signer);
    this.metrics = options.metrics ?? defaultMetrics;
  }

  async processOne(): Promise<boolean> {
    const result = await this.processOneDetailed();
    return result !== 'empty';
  }

  async processOneDetailed(): Promise<'empty' | 'ready' | 'failed' | 'retried' | 'cancelled'> {
    const claimed = await withTransaction(this.options.pool, async (trx) => {
      return new IngestionJobRepository(trx).claimNext(this.workerId);
    });
    if (!claimed) return 'empty';

    const started = Date.now();
    this.log({
      request_id: claimed.job.request_id,
      job_id: claimed.job.id,
      upload_id: claimed.upload.id,
    }, 'ingestion_job_claimed');

    const stopLeaseRenewal = this.startLeaseRenewal(claimed);
    try {
      if (claimed.job.job_type === 'audio_probe') {
        await this.processAudio(claimed);
      } else {
        await this.processArtwork(claimed);
      }
      const finalized = await new IngestionJobRepository(this.options.pool)
        .markReady(claimed.job.id, this.workerId);
      if (!finalized) {
        this.metrics.ingestion('cancelled', (Date.now() - started) / 1000);
        return 'cancelled';
      }
      this.metrics.ingestion('ready', (Date.now() - started) / 1000);
      return 'ready';
    } catch (error) {
      if (error instanceof JobLeaseLostError) {
        this.metrics.ingestion('cancelled', (Date.now() - started) / 1000);
        return 'cancelled';
      }
      const failure = await this.fail(claimed, error);
      if (!failure.recorded) {
        this.metrics.ingestion('cancelled', (Date.now() - started) / 1000);
        return 'cancelled';
      }
      const retry = failure.retryable;
      this.metrics.ingestion(retry ? 'retried' : 'failed', (Date.now() - started) / 1000);
      const code = error instanceof ProbeError || error instanceof ArtworkError
        ? error.code
        : 'INGESTION_FAILED';
      this.metrics.probeFailure(code);
      if (INFRASTRUCTURE_CODES.has(code) || !(error instanceof ProbeError || error instanceof ArtworkError)) {
        this.lastInfrastructureError = true;
      }
      return retry ? 'retried' : 'failed';
    } finally {
      stopLeaseRenewal();
    }
  }

  async runOnce(batchSize = this.options.config.workerOnceBatchSize): Promise<WorkerOnceStats> {
    this.lastInfrastructureError = false;
    await this.reclaimExpiredLeases();
    const stats: WorkerOnceStats = {
      claimed: 0,
      ready: 0,
      failed: 0,
      retried: 0,
      cancelled: 0,
      infrastructureError: false,
    };
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const outcome = await this.processOneDetailed();
        if (outcome === 'empty') break;
        stats.claimed += 1;
        stats[outcome] += 1;
      }
      stats.infrastructureError = this.lastInfrastructureError;
    } finally {
      await this.releaseLease();
    }
    return stats;
  }

  async runLoop(signal: AbortSignal): Promise<void> {
    await this.reclaimExpiredLeases();
    await this.writeHeartbeat();
    while (!signal.aborted) {
      const outcome = await this.processOneDetailed();
      await this.writeHeartbeat();
      if (outcome === 'empty') {
        await this.reclaimExpiredLeases();
        await sleep(this.options.config.workerPollMs, signal);
      }
    }
    await this.releaseLease();
  }

  async reclaimExpiredLeases(): Promise<number> {
    const reclaimed = await new IngestionJobRepository(this.options.pool)
      .reclaimExpiredLeases(this.options.config.workerLeaseSeconds);
    if (reclaimed > 0) {
      this.log({ reclaimed }, 'ingestion_leases_reclaimed');
    }
    return reclaimed;
  }

  async releaseLease(): Promise<void> {
    await this.options.pool.query(`
      UPDATE ingestion_jobs
      SET status = 'pending',
          locked_by = NULL,
          locked_at = NULL,
          updated_at = timezone('utc', now())
      WHERE locked_by = $1 AND status = 'probing'
    `, [this.workerId]);
  }

  async writeHeartbeat(): Promise<void> {
    const path = this.options.config.workerHeartbeatPath;
    if (!path) return;
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Date().toISOString(), 'utf8');
  }

  private startLeaseRenewal(claimed: ClaimedJob): () => void {
    const intervalMs = Math.max(1_000, Math.floor(this.options.config.workerLeaseSeconds * 1000 / 3));
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void new IngestionJobRepository(this.options.pool)
        .renewLease(claimed.job.id, this.workerId)
        .catch((error) => this.log({
          job_id: claimed.job.id,
          detail: error instanceof Error ? error.message : String(error),
        }, 'ingestion_lease_renewal_failed'))
        .finally(() => {
          renewing = false;
        });
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async assertLeaseOwned(db: Queryable, claimed: ClaimedJob): Promise<void> {
    const jobs = new IngestionJobRepository(db);
    if (!await jobs.lockOwnedJob(claimed.job.id, this.workerId)) throw new JobLeaseLostError();
    const upload = await new UploadRepository(db).getUploadForUpdate(claimed.upload.id);
    if (!upload || upload.status === 'cancelled') throw new JobLeaseLostError();
  }

  private log(fields: Record<string, unknown>, message: string): void {
    if (this.options.log) {
      this.options.log(fields, message);
      return;
    }
    const safe = { ...fields };
    if (typeof safe.url === 'string') safe.url = redactSignedUrl(safe.url);
    console.log(JSON.stringify({ msg: message, ...safe }));
  }

  private async processAudio(claimed: ClaimedJob): Promise<void> {
    const tempDir = await this.ensureTempDir();
    const suffix = audioTempExtension(claimed.upload.expected_filename, claimed.upload.expected_mime);
    const tempFile = path.join(tempDir, `${claimed.job.id}${suffix}`);
    try {
      const { size, checksum } = await this.streamToTemp(
        claimed.upload.object_key,
        claimed.upload.bucket,
        tempFile,
        Math.min(
          this.options.config.uploadMaxAudioBytes,
          Math.max(toNumber(claimed.upload.expected_size_bytes), 1),
        ),
      );
      if (size !== toNumber(claimed.upload.expected_size_bytes)) {
        throw new ProbeError('UPLOAD_SIZE_MISMATCH', 'Downloaded object size does not match.');
      }
      if (checksum !== claimed.upload.expected_checksum_sha256) {
        throw new ProbeError('UPLOAD_CHECKSUM_MISMATCH', 'Downloaded object checksum does not match.');
      }
      const probed = await this.options.probe.inspect(tempFile);
      if (!probed.hasAudioStream) {
        throw new ProbeError('PROBE_NO_AUDIO', 'No audio stream was found.');
      }
      this.log({
        request_id: claimed.job.request_id,
        job_id: claimed.job.id,
        container: probed.container,
        codec: probed.codec,
        duration_seconds: probed.durationSeconds,
      }, 'ingestion_audio_probed');

      if (claimed.upload.entity_type === 'import') {
        await this.processImportAudio(claimed, tempFile, probed, size, checksum);
        return;
      }

      await withTransaction(this.options.pool, async (trx) => {
        await this.assertLeaseOwned(trx, claimed);
        await trx.query(`
          UPDATE audio_assets
          SET available = FALSE,
              validation_state = 'cancelled',
              updated_at = timezone('utc', now())
          WHERE track_id = $1 AND source_upload_id IS DISTINCT FROM $2
        `, [claimed.upload.entity_id, claimed.upload.id]);

        await trx.query(`
          INSERT INTO audio_assets (
            id, track_id, storage_key, container, codec, mime_type, sample_rate_hz, bit_depth,
            channels, bitrate_kbps, duration_seconds, file_size_bytes, checksum, is_lossless,
            hi_res, is_dsd, dsd_rate, is_mqa, mqa_status, mqa_orig_sample_rate,
            available, validation_state, source_upload_id
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, TRUE, 'ready', $21
          )
          ON CONFLICT (storage_key) DO UPDATE SET
            container = EXCLUDED.container,
            codec = EXCLUDED.codec,
            mime_type = EXCLUDED.mime_type,
            sample_rate_hz = EXCLUDED.sample_rate_hz,
            bit_depth = EXCLUDED.bit_depth,
            channels = EXCLUDED.channels,
            bitrate_kbps = EXCLUDED.bitrate_kbps,
            duration_seconds = EXCLUDED.duration_seconds,
            file_size_bytes = EXCLUDED.file_size_bytes,
            checksum = EXCLUDED.checksum,
            is_lossless = EXCLUDED.is_lossless,
            hi_res = EXCLUDED.hi_res,
            is_dsd = EXCLUDED.is_dsd,
            dsd_rate = EXCLUDED.dsd_rate,
            is_mqa = EXCLUDED.is_mqa,
            mqa_status = EXCLUDED.mqa_status,
            mqa_orig_sample_rate = EXCLUDED.mqa_orig_sample_rate,
            available = TRUE,
            validation_state = 'ready',
            source_upload_id = EXCLUDED.source_upload_id,
            updated_at = timezone('utc', now())
        `, [
          randomUUID(),
          claimed.upload.entity_id,
          claimed.upload.object_key,
          probed.container,
          probed.codec,
          audioMimeType(probed.codec, probed.container) ?? claimed.upload.expected_mime,
          probed.sampleRateHz,
          probed.bitDepth,
          probed.channels,
          probed.bitrateKbps,
          probed.durationSeconds,
          size,
          checksum,
          probed.isLossless,
          probed.hiRes,
          probed.dsd,
          probed.dsdRate ?? classifyAudio({
            codec: probed.codec,
            container: probed.container,
            sampleRateHz: probed.sampleRateHz,
            bitDepth: probed.bitDepth,
            isLossless: probed.isLossless,
          }).dsdRate,
          Boolean(probed.mqaStatus && probed.mqaStatus !== 'none'),
          probed.mqaStatus && probed.mqaStatus !== 'none' ? probed.mqaStatus : null,
          probed.mqaOrigSampleRate ?? null,
          claimed.upload.id,
        ]);

        await trx.query(`
          UPDATE tracks
          SET duration_seconds = $2, updated_at = timezone('utc', now())
          WHERE id = $1 AND publication_state = 'draft'
        `, [claimed.upload.entity_id, probed.durationSeconds]);

        await trx.query(`
          UPDATE media_uploads
          SET actual_size_bytes = $2, actual_checksum_sha256 = $3, updated_at = timezone('utc', now())
          WHERE id = $1
        `, [claimed.upload.id, size, checksum]);

        await writeAdminAudit(trx, {
          adminUserId: claimed.upload.owner_id,
          action: 'ingestion.audio_ready',
          entityType: 'track',
          entityId: claimed.upload.entity_id,
          metadata: {
            job_id: claimed.job.id,
            container: probed.container,
            codec: probed.codec,
            duration_seconds: probed.durationSeconds,
          },
        });
      });
    } finally {
      await rm(tempFile, { force: true });
    }
  }

  private async processArtwork(claimed: ClaimedJob): Promise<void> {
    const tempDir = await this.ensureTempDir();
    const tempFile = path.join(tempDir, `${claimed.job.id}.img`);
    try {
      const { checksum, buffer } = await this.streamToBuffer(
        claimed.upload.object_key,
        claimed.upload.bucket,
        this.options.config.uploadMaxArtworkBytes,
      );
      if (checksum !== claimed.upload.expected_checksum_sha256) {
        throw new ArtworkError('UPLOAD_CHECKSUM_MISMATCH', 'Downloaded object checksum does not match.');
      }
      const processed = await this.options.artwork.process(buffer);
      const publicBase = this.options.config.publicMediaBaseUrl.replace(/\/+$/, '');
      const variantMeta: Array<{
        name: string;
        width: number;
        height: number;
        format: string;
        object_key: string;
        public_url: string;
        bytes: number;
      }> = [];

      for (const variant of processed.variants) {
        const key = `ingestion/artwork/${claimed.upload.entity_id}/${claimed.job.id}/${variant.name}.${variant.format}`;
        await this.store.putObject(key, {
          body: variant.body,
          contentType: `image/${variant.format}`,
          cacheControl: ARTWORK_CACHE_CONTROL,
        }, claimed.upload.bucket);
        variantMeta.push({
          name: variant.name,
          width: variant.width,
          height: variant.height,
          format: variant.format,
          object_key: key,
          public_url: `${publicBase}/${key}`,
          bytes: variant.bytes,
        });
      }

      const coverUrl = variantMeta.find((item) => item.name === '300')?.public_url
        ?? variantMeta[variantMeta.length - 1]?.public_url
        ?? null;

      await withTransaction(this.options.pool, async (trx) => {
        await this.assertLeaseOwned(trx, claimed);
        await trx.query(`
          INSERT INTO artwork_assets (
            id, entity_type, entity_id, source_upload_id, status, original_object_key, bucket,
            mime_type, width, height, checksum_sha256, variants_json, public_url, available
          ) VALUES (
            $1,$2,$3,$4,'ready',$5,$6,$7,$8,$9,$10,$11::jsonb,$12, TRUE
          )
        `, [
          randomUUID(),
          claimed.upload.entity_type,
          claimed.upload.entity_id,
          claimed.upload.id,
          claimed.upload.object_key,
          claimed.upload.bucket,
          processed.mimeType,
          processed.width,
          processed.height,
          checksum,
          JSON.stringify(variantMeta),
          coverUrl,
        ]);

        const catalog = new AdminCatalogRepository(trx);
        if (claimed.upload.entity_type === 'album' && coverUrl) {
          await catalog.updateAlbum(claimed.upload.entity_id, { coverArtUrl: coverUrl });
        }
        if (claimed.upload.entity_type === 'artist' && coverUrl) {
          await catalog.updateArtist(claimed.upload.entity_id, { imageUrl: coverUrl });
        }

        await writeAdminAudit(trx, {
          adminUserId: claimed.upload.owner_id,
          action: 'ingestion.artwork_ready',
          entityType: claimed.upload.entity_type,
          entityId: claimed.upload.entity_id,
          metadata: { job_id: claimed.job.id, variants: variantMeta.length },
        });
      });
    } finally {
      await rm(tempFile, { force: true });
    }
  }

  private async processImportAudio(
    claimed: ClaimedJob,
    tempFile: string,
    probed: Awaited<ReturnType<AudioProbe['inspect']>>,
    size: number,
    checksum: string,
  ): Promise<void> {
    const imports = new AudioImportRepository(this.options.pool);
    const current = await imports.get(claimed.upload.entity_id);
    if (!current) {
      throw new ProbeError('IMPORT_NOT_FOUND', 'Audio import was not found.');
    }

    const detected = buildDetectedMetadata({
      tags: probed.tags,
      probed,
      filename: claimed.upload.expected_filename,
      fileSizeBytes: size,
    });

    const lyrics = probed.tags.lyrics;

    const match = await buildImportMatch(this.options.pool, {
      artist: detected.artist,
      albumArtist: detected.album_artist,
      album: detected.album,
      year: detected.year,
      musicbrainzArtistId: detected.musicbrainz_artist_id,
      musicbrainzAlbumId: detected.musicbrainz_album_id,
      upc: detected.upc,
    });

    const currentRow = await withTransaction(this.options.pool, async (trx) => {
      await this.assertLeaseOwned(trx, claimed);
      const imports = new AudioImportRepository(trx);
      const row = await imports.getForUpdate(current.id);
      if (!row) throw new ProbeError('IMPORT_NOT_FOUND', 'Audio import was not found.');
      if (row.status === 'cancelled') throw new JobLeaseLostError();
      if (row.status === 'published' || row.status === 'duplicate') {
        await trx.query(`
          UPDATE media_uploads
          SET actual_size_bytes = $2, actual_checksum_sha256 = $3, updated_at = timezone('utc', now())
          WHERE id = $1
        `, [claimed.upload.id, size, checksum]);
        return row;
      }
      await imports.saveProbeResult({
        id: current.id,
        status: 'ready',
        detected,
        match,
      });
      await trx.query(`
        UPDATE media_uploads
        SET actual_size_bytes = $2, actual_checksum_sha256 = $3, updated_at = timezone('utc', now())
        WHERE id = $1
      `, [claimed.upload.id, size, checksum]);
      return (await imports.get(current.id)) ?? row;
    });
    if (currentRow.status === 'published' || currentRow.status === 'duplicate') return;

    const published = await withTransaction(this.options.pool, async (trx) => {
      await this.assertLeaseOwned(trx, claimed);
      const refreshed = await new AudioImportRepository(trx).getForUpdate(current.id);
      if (!refreshed || refreshed.status === 'cancelled') throw new JobLeaseLostError();
      const result = await autoPublishImport(trx, {
        row: refreshed,
        detected,
        adminId: claimed.upload.owner_id,
        requestId: claimed.job.request_id ?? claimed.job.id,
        checksum,
        lyrics: lyrics ? {
          kind: lyrics.kind,
          synced_lrc: lyrics.synced_lrc,
          plain_text: lyrics.plain_text,
          lines: lyrics.parsed.lines,
          offset: lyrics.parsed.offset,
        } : null,
      });
      await writeAdminAudit(trx, {
        adminUserId: claimed.upload.owner_id,
        action: 'ingestion.import_ready',
        entityType: 'import',
        entityId: current.id,
        metadata: {
          job_id: claimed.job.id,
          container: probed.container,
          codec: probed.codec,
        },
      });
      return result;
    });
    if (published.status === 'published') {
      await fillCatalogRemoteArtwork(
        this.options.pool,
        this.options.remoteArtwork,
        published.artistId,
        published.albumId,
        (error) => this.log({
          detail: error instanceof Error ? error.message : String(error),
        }, 'remote_artwork_lookup_failed'),
      );
    }
  }

  private async fail(claimed: ClaimedJob, error: unknown): Promise<{ retryable: boolean; recorded: boolean }> {
    const code = error instanceof ProbeError || error instanceof ArtworkError
      ? error.code
      : 'INGESTION_FAILED';
    const retryable = (error instanceof ProbeError || error instanceof ArtworkError)
      && error.retryable
      && claimed.job.attempts < claimed.job.max_attempts
      && TRANSIENT_CODES.has(code);
    const retryAt = retryable
      ? new Date(Date.now() + Math.min(60_000, 2 ** claimed.job.attempts * 1000))
      : null;
    this.log({
      request_id: claimed.job.request_id,
      job_id: claimed.job.id,
      error_code: code,
      retryable,
      detail: error instanceof Error ? error.message : String(error),
    }, 'ingestion_job_failed');

    const recorded = await withTransaction(this.options.pool, async (trx) => {
      const updated = await new IngestionJobRepository(trx).markFailed(
        claimed.job.id,
        this.workerId,
        code,
        'Ingestion failed.',
        retryAt,
      );
      if (!updated) return false;
      if (claimed.job.job_type === 'audio_probe') {
        await trx.query(`
          UPDATE audio_assets
          SET available = FALSE, validation_state = 'failed', updated_at = timezone('utc', now())
          WHERE source_upload_id = $1
        `, [claimed.upload.id]);
        const imports = new AudioImportRepository(trx);
        const importRow = claimed.upload.entity_type === 'import'
          ? (await imports.get(claimed.upload.entity_id) ?? await imports.getByUploadId(claimed.upload.id))
          : await imports.getByUploadId(claimed.upload.id);
        if (importRow) {
          await imports.setStatus(importRow.id, 'failed', {
            code,
            message: publicImportError(code),
          });
        }
      }
      await writeAdminAudit(trx, {
        adminUserId: claimed.upload.owner_id,
        action: 'ingestion.failed',
        entityType: claimed.upload.entity_type,
        entityId: claimed.upload.entity_id,
        metadata: { job_id: claimed.job.id, error_code: code, retryable },
      });
      return true;
    });
    return { retryable, recorded };
  }

  private async streamToTemp(
    objectKey: string,
    bucket: string,
    dest: string,
    maxBytes: number,
  ): Promise<{ size: number; checksum: string }> {
    const hash = createHash('sha256');
    let size = 0;
    try {
      const stream = await this.store.getObjectStream(objectKey, bucket);
      const output = createWriteStream(dest);
      try {
        for await (const chunk of stream) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.length;
          if (size > maxBytes) {
            abortObjectStream(stream);
            output.destroy();
            throw new ProbeError('UPLOAD_SIZE_MISMATCH', 'Downloaded object exceeds the size limit.', true);
          }
          hash.update(buf);
          if (!output.write(buf)) {
            await new Promise<void>((resolve, reject) => {
              output.once('drain', resolve);
              output.once('error', reject);
            });
          }
        }
        await new Promise<void>((resolve, reject) => {
          output.end((error: Error | null | undefined) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (error) {
        output.destroy();
        throw error;
      }
      return { size, checksum: hash.digest('hex') };
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      throw new ProbeError('OBJECT_DOWNLOAD_FAILED', 'Could not download the uploaded object.', true);
    }
  }

  private async streamToBuffer(
    objectKey: string,
    bucket: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; checksum: string }> {
    const stream = await this.store.getObjectStream(objectKey, bucket);
    const chunks: Buffer[] = [];
    let size = 0;
    const hash = createHash('sha256');
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) throw new ArtworkError('ARTWORK_TOO_LARGE', 'Artwork exceeds the byte limit.');
      hash.update(buf);
      chunks.push(buf);
    }
    return { buffer: Buffer.concat(chunks), checksum: hash.digest('hex') };
  }

  private async ensureTempDir(): Promise<string> {
    const dir = this.options.config.workerTempDir
      || path.join(tmpdir(), 'nghenhac-ingest');
    await mkdir(dir, { recursive: true });
    return dir;
  }
}

function abortObjectStream(stream: NodeJS.ReadableStream): void {
  if (stream instanceof Readable) {
    stream.destroy();
    return;
  }
  const cancelable = stream as { destroy?: () => void; cancel?: () => void };
  cancelable.destroy?.();
  cancelable.cancel?.();
}

function publicImportError(code: string): string {
  if (code === 'PROBE_UNSUPPORTED') return 'This audio format is not supported.';
  if (code === 'PROBE_NO_AUDIO') return 'No audio stream was found.';
  if (code === 'UPLOAD_CHECKSUM_MISMATCH' || code === 'UPLOAD_SIZE_MISMATCH') {
    return 'Uploaded file did not match the expected size or checksum.';
  }
  return 'Audio processing failed.';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

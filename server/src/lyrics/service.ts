import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { CatalogRepository } from '../catalog/repository.js';
import { withTransaction } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import type { TransactionRunner } from '../library/service.js';
import { cleanLyricDisplayText, parseLrc, type ParsedLyricLine } from './parseLrc.js';
import type { LyricsProvider, LyricsProviderResult } from './provider.js';
import { LyricsRepository, type LyricsRow, type LyricsStatus } from './repository.js';

export interface LyricsResponse {
  is_synced: boolean;
  lines: ParsedLyricLine[];
  plain_text: string | null;
  source: string;
  instrumental: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  by?: string | null;
  offset?: number;
}

export interface ResolveLyricsInput {
  track_id: string;
  title?: string;
  artist?: string;
  album?: string;
  duration_seconds?: number;
}

export class LyricsService {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: CatalogRepository,
    private readonly provider: LyricsProvider,
    private readonly config: AppConfig,
    private readonly runTx: TransactionRunner = withTransaction,
  ) {}

  async getCached(_userId: string, trackId: string): Promise<LyricsResponse> {
    const exists = await this.catalog.trackExists(trackId);
    if (!exists) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
    }
    const row = await new LyricsRepository(this.pool).get(trackId);
    if (!row || isExpired(row) || row.status === 'not_found') {
      throw new AppError(404, ErrorCodes.LYRICS_NOT_FOUND, 'Lyrics not found.');
    }
    return toResponse(row);
  }

  async resolve(_userId: string, input: ResolveLyricsInput): Promise<LyricsResponse> {
    const outcome = await this.runTx(this.pool, async (trx) => {
      const catalog = new CatalogRepository(trx);
      const record = await catalog.getTrackRecord(input.track_id);
      if (!record || record.deletedAt || record.publicationState !== 'published') {
        throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
      }

      const repo = new LyricsRepository(trx);
      await repo.lockTrack(input.track_id);

      const cached = await repo.get(input.track_id);
      if (cached && cached.provider === 'embedded' && cached.status === 'found') {
        return { kind: 'hit' as const, response: toResponse(cached) };
      }
      if (cached && !isExpired(cached)) {
        if (cached.status === 'not_found') {
          return { kind: 'miss' as const };
        }
        return { kind: 'hit' as const, response: toResponse(cached) };
      }

      const result = await this.provider.resolve({
        title: record.track.title,
        artist: record.track.artist,
        album: record.track.album,
        durationSeconds: record.track.duration,
        genre: record.track.genre,
      });

      if (!result) {
        await repo.upsert(notFoundRow(input.track_id, this.config.lyricsNegativeTtlSeconds, record.track));
        return { kind: 'miss' as const };
      }

      const stored = toStored(
        input.track_id,
        result,
        record.track,
        this.config.lyricsPositiveTtlSeconds,
        this.config.lyricsNegativeTtlSeconds,
      );
      await repo.upsert(stored);
      const fresh = await repo.get(input.track_id);
      if (!fresh || fresh.status === 'not_found') {
        return { kind: 'miss' as const };
      }
      return { kind: 'hit' as const, response: toResponse(fresh) };
    });

    if (outcome.kind === 'miss') {
      throw new AppError(404, ErrorCodes.LYRICS_NOT_FOUND, 'Lyrics not found.');
    }
    return outcome.response;
  }
}

function isExpired(row: LyricsRow): boolean {
  const expires = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  return expires.getTime() <= Date.now();
}

function toResponse(row: LyricsRow): LyricsResponse {
  return {
    is_synced: row.is_synced,
    lines: (row.lines_json ?? []).map((line) => ({
      ...line,
      text: cleanLyricDisplayText(line.text),
    })),
    plain_text: row.plain_text,
    source: row.provider === 'lrclib' ? 'lrclib' : row.provider === 'embedded' ? 'embedded' : 'local',
    instrumental: row.instrumental || row.status === 'instrumental',
    title: row.title,
    artist: row.artist,
    album: row.album,
    by: row.attribution,
    offset: row.lyric_offset ?? 0,
  };
}

function notFoundRow(
  trackId: string,
  ttlSeconds: number,
  track: { title: string; artist: string; album: string },
) {
  return {
    trackId,
    status: 'not_found' as const,
    provider: null,
    syncedLrc: null,
    plainText: null,
    lines: null,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    attribution: null,
    title: track.title,
    artist: track.artist,
    album: track.album,
    isSynced: false,
    instrumental: false,
    offset: null,
  };
}

function toStored(
  trackId: string,
  result: LyricsProviderResult,
  track: { title: string; artist: string; album: string },
  positiveTtlSeconds: number,
  negativeTtlSeconds: number,
) {
  if (result.instrumental) {
    return {
      trackId,
      status: 'instrumental' as LyricsStatus,
      provider: result.source,
      syncedLrc: null,
      plainText: result.plainText ?? null,
      lines: [],
      expiresAt: new Date(Date.now() + positiveTtlSeconds * 1000),
      attribution: result.by ?? null,
      title: result.title ?? track.title,
      artist: result.artist ?? track.artist,
      album: result.album ?? track.album,
      isSynced: false,
      instrumental: true,
      offset: 0,
    };
  }

  const synced = result.syncedLrc?.trim() ? parseLrc(result.syncedLrc) : null;
  const lines = synced?.lines ?? [];
  const plain = result.plainText ?? synced?.plain_text ?? null;
  const hasText = Boolean(plain?.trim()) || lines.length > 0;
  if (!hasText) {
    return notFoundRow(trackId, negativeTtlSeconds, track);
  }

  return {
    trackId,
    status: 'found' as LyricsStatus,
    provider: result.source,
    syncedLrc: result.syncedLrc ?? null,
    plainText: plain,
    lines,
    expiresAt: new Date(Date.now() + positiveTtlSeconds * 1000),
    attribution: result.by ?? synced?.by ?? null,
    title: result.title ?? synced?.title ?? track.title,
    artist: result.artist ?? synced?.artist ?? track.artist,
    album: result.album ?? synced?.album ?? track.album,
    isSynced: lines.length > 0,
    instrumental: false,
    offset: synced?.offset ?? 0,
  };
}

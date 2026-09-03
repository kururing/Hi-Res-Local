import type { Pool } from 'pg';
import type { Queryable } from '../db/types.js';
import { query, toNumber, withTransaction } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { decodeCursor, encodeCursor, parseLimit } from '../http/cursor.js';
import { CatalogRepository } from '../catalog/repository.js';
import type { FrontendLibraryStats, FrontendTrack } from '../catalog/mapper.js';

export interface LibraryChange {
  change_id: string;
  entity_type: 'track';
  operation: 'upsert' | 'delete';
  entity_id: string;
  created_at: string;
}

export interface LibraryChangesPage {
  changes: LibraryChange[];
  next_cursor: string | null;
  has_more: boolean;
}

interface ChangeCursor {
  changeId: string;
}

export class LibraryRepository {
  constructor(private readonly db: Queryable) {}

  async trackExists(trackId: string): Promise<boolean> {
    const result = await query(this.db, 'SELECT 1 FROM tracks WHERE id = $1', [trackId]);
    return (result.rowCount ?? 0) > 0;
  }

  async insertLibraryTrack(userId: string, trackId: string): Promise<boolean> {
    const result = await query(this.db, `
      INSERT INTO user_library_tracks (user_id, track_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, track_id) DO NOTHING
    `, [userId, trackId]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteLibraryTrack(userId: string, trackId: string): Promise<boolean> {
    const result = await query(this.db, `
      DELETE FROM user_library_tracks
      WHERE user_id = $1 AND track_id = $2
    `, [userId, trackId]);
    return (result.rowCount ?? 0) > 0;
  }

  async insertChange(
    userId: string,
    entityType: 'track',
    operation: 'upsert' | 'delete',
    entityId: string,
  ): Promise<void> {
    await query(this.db, `
      INSERT INTO library_changes (user_id, entity_type, operation, entity_id)
      VALUES ($1, $2, $3, $4)
    `, [userId, entityType, operation, entityId]);
  }

  async listLibraryTrackIds(userId: string): Promise<Array<{ track_id: string; created_at: Date | string }>> {
    const result = await query<{ track_id: string; created_at: Date | string }>(this.db, `
      SELECT track_id, created_at
      FROM user_library_tracks
      WHERE user_id = $1
      ORDER BY created_at DESC, track_id
    `, [userId]);
    return result.rows;
  }

  async stats(userId: string): Promise<FrontendLibraryStats> {
    const result = await query<{
      total_tracks: string | number;
      total_albums: string | number;
      total_artists: string | number;
      total_duration_secs: string | number;
      total_size_bytes: string | number;
    }>(this.db, `
      SELECT
        COUNT(ult.track_id)::int AS total_tracks,
        COUNT(DISTINCT t.album_id)::int AS total_albums,
        COALESCE((
          SELECT COUNT(DISTINCT ta.artist_id)::int
          FROM user_library_tracks ult2
          JOIN track_artists ta ON ta.track_id = ult2.track_id
          WHERE ult2.user_id = $1
        ), 0) AS total_artists,
        COALESCE(SUM(t.duration_seconds), 0)::float8 AS total_duration_secs,
        COALESCE(SUM(best.file_size_bytes), 0)::bigint AS total_size_bytes
      FROM user_library_tracks ult
      JOIN tracks t ON t.id = ult.track_id
      LEFT JOIN LATERAL (
        SELECT aa.file_size_bytes
        FROM audio_assets aa
        WHERE aa.track_id = t.id AND aa.available = TRUE
        ORDER BY aa.is_lossless DESC,
                 (aa.sample_rate_hz * COALESCE(aa.bit_depth, 16) * aa.channels) DESC
        LIMIT 1
      ) best ON TRUE
      WHERE ult.user_id = $1
    `, [userId]);

    const row = result.rows[0];
    return {
      total_tracks: toNumber(row?.total_tracks ?? 0),
      total_artists: toNumber(row?.total_artists ?? 0),
      total_albums: toNumber(row?.total_albums ?? 0),
      total_duration_secs: toNumber(row?.total_duration_secs ?? 0),
      total_size_bytes: toNumber(row?.total_size_bytes ?? 0),
    };
  }

  async listChanges(userId: string, cursor: string | undefined, limit: number): Promise<LibraryChangesPage> {
    const parsed = cursor ? decodeCursor<ChangeCursor>(cursor) : null;
    const afterId = parsed ? BigInt(parsed.changeId) : 0n;

    const result = await query<{
      change_id: string;
      entity_type: 'track';
      operation: 'upsert' | 'delete';
      entity_id: string;
      created_at: Date | string;
    }>(this.db, `
      SELECT change_id, entity_type, operation, entity_id, created_at
      FROM library_changes
      WHERE user_id = $1 AND change_id > $2
      ORDER BY change_id ASC
      LIMIT $3
    `, [userId, afterId.toString(), limit + 1]);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const last = rows[rows.length - 1];

    return {
      changes: rows.map((row) => ({
        change_id: String(row.change_id),
        entity_type: row.entity_type,
        operation: row.operation,
        entity_id: row.entity_id,
        created_at: row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
      })),
      next_cursor: hasMore && last
        ? encodeCursor({ changeId: String(last.change_id) } satisfies ChangeCursor)
        : null,
      has_more: hasMore,
    };
  }
}

export type TransactionRunner = <T>(pool: Pool, fn: (client: Queryable) => Promise<T>) => Promise<T>;

export class LibraryService {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: CatalogRepository,
    private readonly runTx: TransactionRunner = withTransaction,
  ) {}

  async listTracks(userId: string): Promise<FrontendTrack[]> {
    const repo = new LibraryRepository(this.pool);
    const rows = await repo.listLibraryTrackIds(userId);
    const dateAdded = new Map(rows.map((row) => [row.track_id, row.created_at]));
    return this.catalog.getTracksByIds(rows.map((row) => row.track_id), dateAdded, userId);
  }

  async stats(userId: string): Promise<FrontendLibraryStats> {
    return new LibraryRepository(this.pool).stats(userId);
  }

  roots(): [] {
    return [];
  }

  async addTrack(userId: string, trackId: string): Promise<void> {
    await this.runTx(this.pool, async (trx) => {
      const repo = new LibraryRepository(trx);
      const exists = await new CatalogRepository(trx).trackExists(trackId);
      if (!exists) {
        throw new AppError(404, ErrorCodes.LIBRARY_TRACK_NOT_FOUND, 'Track not found.');
      }
      const inserted = await repo.insertLibraryTrack(userId, trackId);
      if (inserted) {
        await repo.insertChange(userId, 'track', 'upsert', trackId);
      }
    });
  }

  async removeTrack(userId: string, trackId: string): Promise<void> {
    await this.runTx(this.pool, async (trx) => {
      const repo = new LibraryRepository(trx);
      const deleted = await repo.deleteLibraryTrack(userId, trackId);
      if (deleted) {
        await repo.insertChange(userId, 'track', 'delete', trackId);
      }
    });
  }

  async listChanges(userId: string, cursor: string | undefined, limitRaw: number | undefined): Promise<LibraryChangesPage> {
    const limit = parseLimit(limitRaw, 100, 500);
    return new LibraryRepository(this.pool).listChanges(userId, cursor, limit);
  }
}

import type { Pool } from 'pg';
import { CatalogRepository } from '../catalog/repository.js';
import type { FrontendTrack } from '../catalog/mapper.js';
import { withTransaction } from '../db/types.js';
import { isUniqueViolation } from '../db/pgErrors.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import type { TransactionRunner } from '../library/service.js';
import { parseLimit } from '../http/cursor.js';
import {
  HistoryRepository,
  historyId,
  historyPlayedAt,
  type HistoryRow,
} from './repository.js';
import {
  assertCompletedDuration,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  resolveIdempotencyKey,
} from './validation.js';

export interface PlayHistoryEntry {
  id: number;
  track_id: string;
  track: FrontendTrack | null;
  played_at: string;
  completed_duration_ms: number;
  fully_played: boolean;
}

export interface RecordHistoryInput {
  track_id: string;
  completed_duration_ms: number;
  fully_played: boolean;
  client_request_id?: string;
}

export class HistoryService {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: CatalogRepository,
    private readonly runTx: TransactionRunner = withTransaction,
  ) {}

  async record(
    userId: string,
    input: RecordHistoryInput,
    headerKey?: string,
  ): Promise<PlayHistoryEntry> {
    const requestId = resolveIdempotencyKey(headerKey, input.client_request_id);

    const row = await this.runTx(this.pool, async (trx) => {
      const catalog = new CatalogRepository(trx);
      const duration = await catalog.getTrackDurationSeconds(input.track_id);
      if (duration == null) {
        throw new AppError(404, ErrorCodes.HISTORY_TRACK_NOT_FOUND, 'Track not found.');
      }
      assertCompletedDuration(input.completed_duration_ms, duration);

      const repo = new HistoryRepository(trx);
      if (requestId) {
        const existing = await repo.findByRequestId(userId, requestId);
        if (existing) return existing;
      }

      try {
        return await repo.insert({
          userId,
          trackId: input.track_id,
          completedDurationMs: input.completed_duration_ms,
          fullyPlayed: input.fully_played,
          clientRequestId: requestId,
        });
      } catch (error) {
        if (requestId && isUniqueViolation(error)) {
          const replayed = await repo.findByRequestId(userId, requestId);
          if (replayed) return replayed;
        }
        throw error;
      }
    });

    return this.toEntry(userId, row);
  }

  async list(userId: string, limitRaw?: number, offsetRaw?: number): Promise<PlayHistoryEntry[]> {
    const limit = parseLimit(limitRaw, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
    const offset = offsetRaw ?? 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'offset cannot be negative.');
    }
    const rows = await new HistoryRepository(this.pool).list(userId, limit, offset);
    const records = await this.catalog.getTrackRecordsByIds(
      rows.map((row) => row.track_id),
      undefined,
      userId,
    );
    return rows.map((row) => {
      const record = records.get(row.track_id);
      return {
        id: historyId(row),
        track_id: row.track_id,
        track: record?.available ? record.track : null,
        played_at: historyPlayedAt(row),
        completed_duration_ms: row.completed_duration_ms,
        fully_played: row.fully_played,
      };
    });
  }

  async clear(userId: string): Promise<number> {
    return this.runTx(this.pool, async (trx) => new HistoryRepository(trx).clear(userId));
  }

  private async toEntry(userId: string, row: HistoryRow): Promise<PlayHistoryEntry> {
    const record = await this.catalog.getTrackRecord(row.track_id, userId);
    return {
      id: historyId(row),
      track_id: row.track_id,
      track: record?.available ? record.track : null,
      played_at: historyPlayedAt(row),
      completed_duration_ms: row.completed_duration_ms,
      fully_played: row.fully_played,
    };
  }
}

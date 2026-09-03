import type { Queryable } from '../db/types.js';
import { query, toIso, toNumber } from '../db/types.js';

export interface HistoryRow {
  id: string | number;
  track_id: string;
  played_at: Date | string;
  completed_duration_ms: number;
  fully_played: boolean;
}

export class HistoryRepository {
  constructor(private readonly db: Queryable) {}

  async insert(input: {
    userId: string;
    trackId: string;
    completedDurationMs: number;
    fullyPlayed: boolean;
    clientRequestId: string | null;
  }): Promise<HistoryRow> {
    const result = await query<HistoryRow>(this.db, `
      INSERT INTO play_history (
        user_id, track_id, completed_duration_ms, fully_played, client_request_id
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, track_id, played_at, completed_duration_ms, fully_played
    `, [
      input.userId,
      input.trackId,
      input.completedDurationMs,
      input.fullyPlayed,
      input.clientRequestId,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error('History insert did not return a row.');
    return row;
  }

  async findByRequestId(userId: string, clientRequestId: string): Promise<HistoryRow | null> {
    const result = await query<HistoryRow>(this.db, `
      SELECT id, track_id, played_at, completed_duration_ms, fully_played
      FROM play_history
      WHERE user_id = $1 AND client_request_id = $2
    `, [userId, clientRequestId]);
    return result.rows[0] ?? null;
  }

  async list(userId: string, limit: number, offset: number): Promise<HistoryRow[]> {
    const result = await query<HistoryRow>(this.db, `
      SELECT id, track_id, played_at, completed_duration_ms, fully_played
      FROM play_history
      WHERE user_id = $1
      ORDER BY played_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);
    return result.rows;
  }

  async clear(userId: string): Promise<number> {
    const result = await query(
      this.db,
      'DELETE FROM play_history WHERE user_id = $1',
      [userId],
    );
    return result.rowCount ?? 0;
  }
}

export function historyId(row: HistoryRow): number {
  return toNumber(row.id);
}

export function historyPlayedAt(row: HistoryRow): string {
  return toIso(row.played_at);
}

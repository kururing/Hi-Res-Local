import type { Queryable } from '../db/types.js';
import { query, toIso, toNumber } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';

export interface BackendPlaylist {
  id: string;
  name: string;
  description: string | null;
  is_smart: boolean;
  rules_json: string | null;
  cover_art_path: string | null;
  track_count: number;
  total_duration_ms: number;
  created_at: string;
  updated_at: string;
}

interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  is_smart: boolean;
  rules_json: string | null;
  cover_art_path: string | null;
  track_count: string | number;
  total_duration_ms: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

const PLAYLIST_SELECT = `
  SELECT
    p.id,
    p.name,
    p.description,
    p.is_smart,
    p.rules_json,
    p.cover_art_path,
    COUNT(pt.track_id)::int AS track_count,
    COALESCE(ROUND(SUM(t.duration_seconds) * 1000), 0)::bigint AS total_duration_ms,
    p.created_at,
    p.updated_at
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

function mapPlaylist(row: PlaylistRow): BackendPlaylist {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_smart: row.is_smart,
    rules_json: row.rules_json,
    cover_art_path: row.cover_art_path,
    track_count: toNumber(row.track_count),
    total_duration_ms: toNumber(row.total_duration_ms),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export class PlaylistRepository {
  constructor(private readonly db: Queryable) {}

  async lockOwned(userId: string, playlistId: string): Promise<void> {
    const result = await query(
      this.db,
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [playlistId, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError(404, ErrorCodes.PLAYLIST_NOT_FOUND, 'Playlist not found.');
    }
  }

  async getOwned(userId: string, playlistId: string): Promise<BackendPlaylist> {
    const result = await query<PlaylistRow>(this.db, `
      ${PLAYLIST_SELECT}
      WHERE p.id = $1 AND p.user_id = $2
      GROUP BY p.id
    `, [playlistId, userId]);
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, ErrorCodes.PLAYLIST_NOT_FOUND, 'Playlist not found.');
    }
    return mapPlaylist(row);
  }

  async list(userId: string): Promise<BackendPlaylist[]> {
    const result = await query<PlaylistRow>(this.db, `
      ${PLAYLIST_SELECT}
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id DESC
    `, [userId]);
    return result.rows.map(mapPlaylist);
  }

  async insert(input: {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    isSmart: boolean;
    rulesJson: string | null;
  }): Promise<BackendPlaylist> {
    await query(this.db, `
      INSERT INTO playlists (id, user_id, name, description, is_smart, rules_json)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [input.id, input.userId, input.name, input.description, input.isSmart, input.rulesJson]);
    return this.getOwned(input.userId, input.id);
  }

  async update(
    userId: string,
    playlistId: string,
    patch: {
      name?: string;
      description?: string | null;
      isSmart?: boolean;
      rulesJson?: string | null;
      coverArtPath?: string | null;
    },
  ): Promise<BackendPlaylist> {
    const sets: string[] = ['updated_at = timezone(\'utc\', now())'];
    const values: unknown[] = [];
    let index = 1;
    if (patch.name !== undefined) {
      sets.push(`name = $${index++}`);
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${index++}`);
      values.push(patch.description);
    }
    if (patch.isSmart !== undefined) {
      sets.push(`is_smart = $${index++}`);
      values.push(patch.isSmart);
    }
    if (patch.rulesJson !== undefined) {
      sets.push(`rules_json = $${index++}`);
      values.push(patch.rulesJson);
    }
    if (patch.coverArtPath !== undefined) {
      sets.push(`cover_art_path = $${index++}`);
      values.push(patch.coverArtPath);
    }
    values.push(playlistId, userId);
    const result = await query(
      this.db,
      `UPDATE playlists SET ${sets.join(', ')} WHERE id = $${index++} AND user_id = $${index} `,
      values,
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError(404, ErrorCodes.PLAYLIST_NOT_FOUND, 'Playlist not found.');
    }
    return this.getOwned(userId, playlistId);
  }

  async delete(userId: string, playlistId: string): Promise<boolean> {
    const result = await query(
      this.db,
      'DELETE FROM playlists WHERE id = $1 AND user_id = $2',
      [playlistId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listMembership(playlistId: string): Promise<Array<{ track_id: string; position: number; added_at: Date | string }>> {
    const result = await query<{ track_id: string; position: number; added_at: Date | string }>(this.db, `
      SELECT track_id, position, added_at
      FROM playlist_tracks
      WHERE playlist_id = $1
      ORDER BY position ASC, track_id
    `, [playlistId]);
    return result.rows;
  }

  async maxPosition(playlistId: string): Promise<number> {
    const result = await query<{ max: string | number | null }>(
      this.db,
      'SELECT MAX(position) AS max FROM playlist_tracks WHERE playlist_id = $1',
      [playlistId],
    );
    const value = result.rows[0]?.max;
    return value == null ? -1 : toNumber(value);
  }

  async insertTrack(playlistId: string, trackId: string, position: number): Promise<boolean> {
    const result = await query(this.db, `
      INSERT INTO playlist_tracks (playlist_id, track_id, position)
      VALUES ($1, $2, $3)
      ON CONFLICT (playlist_id, track_id) DO NOTHING
    `, [playlistId, trackId, position]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteTracks(playlistId: string, trackIds: string[]): Promise<number> {
    if (trackIds.length === 0) return 0;
    const result = await query(this.db, `
      DELETE FROM playlist_tracks
      WHERE playlist_id = $1 AND track_id = ANY($2::uuid[])
    `, [playlistId, trackIds]);
    return result.rowCount ?? 0;
  }

  async setPosition(playlistId: string, trackId: string, position: number): Promise<void> {
    await query(this.db, `
      UPDATE playlist_tracks SET position = $3
      WHERE playlist_id = $1 AND track_id = $2
    `, [playlistId, trackId, position]);
  }

  async touch(playlistId: string): Promise<void> {
    await query(
      this.db,
      `UPDATE playlists SET updated_at = timezone('utc', now()) WHERE id = $1`,
      [playlistId],
    );
  }

  async existingTrackIds(trackIds: string[]): Promise<Set<string>> {
    if (trackIds.length === 0) return new Set();
    const result = await query<{ id: string }>(
      this.db,
      'SELECT id FROM tracks WHERE id = ANY($1::uuid[]) AND publication_state = \'published\' AND deleted_at IS NULL',
      [trackIds],
    );
    return new Set(result.rows.map((row) => row.id));
  }
}

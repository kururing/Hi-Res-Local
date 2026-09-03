import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';
import type { ParsedLyricLine } from './parseLrc.js';

export type LyricsStatus = 'found' | 'instrumental' | 'not_found';

export interface LyricsRow {
  track_id: string;
  status: LyricsStatus;
  provider: string | null;
  synced_lrc: string | null;
  plain_text: string | null;
  lines_json: ParsedLyricLine[] | null;
  fetched_at: Date | string;
  expires_at: Date | string;
  attribution: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  is_synced: boolean;
  instrumental: boolean;
  lyric_offset: number | null;
}

export class LyricsRepository {
  constructor(private readonly db: Queryable) {}

  async lockTrack(trackId: string): Promise<void> {
    await query(this.db, 'SELECT pg_advisory_xact_lock(hashtext($1))', [`lyrics:${trackId}`]);
  }

  async get(trackId: string): Promise<LyricsRow | null> {
    const result = await query<LyricsRow>(this.db, `
      SELECT
        track_id, status, provider, synced_lrc, plain_text, lines_json,
        fetched_at, expires_at, attribution, title, artist, album,
        is_synced, instrumental, lyric_offset
      FROM track_lyrics
      WHERE track_id = $1
    `, [trackId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      lines_json: Array.isArray(row.lines_json) ? row.lines_json : null,
    };
  }

  async upsert(row: {
    trackId: string;
    status: LyricsStatus;
    provider: string | null;
    syncedLrc: string | null;
    plainText: string | null;
    lines: ParsedLyricLine[] | null;
    expiresAt: Date;
    attribution: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    isSynced: boolean;
    instrumental: boolean;
    offset: number | null;
  }): Promise<void> {
    await query(this.db, `
      INSERT INTO track_lyrics (
        track_id, status, provider, synced_lrc, plain_text, lines_json,
        fetched_at, expires_at, attribution, title, artist, album,
        is_synced, instrumental, lyric_offset
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb,
        timezone('utc', now()), $7, $8, $9, $10, $11,
        $12, $13, $14
      )
      ON CONFLICT (track_id) DO UPDATE SET
        status = EXCLUDED.status,
        provider = EXCLUDED.provider,
        synced_lrc = EXCLUDED.synced_lrc,
        plain_text = EXCLUDED.plain_text,
        lines_json = EXCLUDED.lines_json,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at,
        attribution = EXCLUDED.attribution,
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        album = EXCLUDED.album,
        is_synced = EXCLUDED.is_synced,
        instrumental = EXCLUDED.instrumental,
        lyric_offset = EXCLUDED.lyric_offset
    `, [
      row.trackId,
      row.status,
      row.provider,
      row.syncedLrc,
      row.plainText,
      row.lines ? JSON.stringify(row.lines) : null,
      row.expiresAt,
      row.attribution,
      row.title,
      row.artist,
      row.album,
      row.isSynced,
      row.instrumental,
      row.offset,
    ]);
  }
}

import type { Queryable } from '../db/types.js';
import { query, toNumber } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { decodeCursor, encodeCursor, parseLimit } from '../http/cursor.js';
import { normalizeCatalogName } from './normalize.js';
import {
  emptyLibraryStats,
  toFrontendTrack,
  type DisplayAsset,
  type FrontendAlbum,
  type FrontendArtist,
  type FrontendLibraryStats,
  type FrontendTrack,
  type NamedArtist,
} from './mapper.js';
import { classifyAudio } from '../ingestion/classification.js';
import { fidelityScore, type SelectableAsset } from '../streaming/assetSelector.js';

export interface CatalogSearchQuery {
  q?: string;
  type?: 'all' | 'track' | 'album' | 'artist';
  limit?: number;
  cursor?: string;
}

export interface SearchArtistHit {
  id: string;
  name: string;
  image_url: string | null;
  track_count: number;
  album_count: number;
}

export interface SearchAlbumHit {
  id: string;
  name: string;
  artist: string;
  year: number | null;
  track_count: number;
  total_duration: number;
  cover_url: string | null;
}

export type SearchResultItem =
  | { type: 'artist'; id: string; artist: SearchArtistHit }
  | { type: 'album'; id: string; album: SearchAlbumHit }
  | { type: 'track'; id: string; track: FrontendTrack };

export interface SearchPage {
  items: SearchResultItem[];
  next_cursor: string | null;
  has_more: boolean;
}

interface SearchCursor {
  sortName: string;
  id: string;
}

interface JsonArtist {
  name?: string;
  image_url?: string | null;
}

interface JsonAsset {
  id: string;
  storage_key: string;
  container: string;
  codec: string;
  sample_rate_hz: number;
  bit_depth: number | null;
  channels: number;
  bitrate_kbps: number | null;
  duration_seconds: number | string;
  file_size_bytes?: number | string | null;
  is_lossless: boolean;
  hi_res?: boolean | null;
  is_dsd?: boolean | null;
  dsd_rate?: number | null;
  is_mqa?: boolean | null;
  mqa_status?: string | null;
  mqa_orig_sample_rate?: number | null;
  replaygain_track_gain?: number | null;
  replaygain_track_peak?: number | null;
  replaygain_album_gain?: number | null;
  replaygain_album_peak?: number | null;
  checksum?: string | null;
  available: boolean;
}

interface TrackQueryRow {
  id: string;
  title: string;
  album_id: string | null;
  album_title: string | null;
  year: number | null;
  genre: string | null;
  cover_art_url: string | null;
  track_number: number | null;
  disc_number: number | null;
  duration_seconds: number | string;
  available: boolean;
  publication_state: 'draft' | 'published';
  deleted_at: Date | string | null;
  created_at: Date | string;
  date_added: Date | string;
  artists: JsonArtist[] | null;
  assets: JsonAsset[] | null;
  is_favorite: boolean;
  play_count: string | number;
  last_played_at: Date | string | null;
  isrc: string | null;
  musicbrainz_track_id: string | null;
}

function trackSelectSql(dateAddedExpr: string, userIdParam: number | null): string {
  const userJoins = userIdParam == null
    ? ''
    : `
    LEFT JOIN user_favorite_tracks uft
      ON uft.track_id = t.id AND uft.user_id = $${userIdParam}
    LEFT JOIN (
      SELECT ph.track_id,
             COUNT(*)::int AS play_count,
             MAX(ph.played_at) AS last_played_at
      FROM play_history ph
      WHERE ph.user_id = $${userIdParam}
      GROUP BY ph.track_id
    ) hist ON hist.track_id = t.id`;

  const favoriteSelect = userIdParam == null
    ? 'FALSE AS is_favorite'
    : '(uft.track_id IS NOT NULL) AS is_favorite';
  const playCountSelect = userIdParam == null
    ? '0 AS play_count'
    : 'COALESCE(hist.play_count, 0) AS play_count';
  const lastPlayedSelect = userIdParam == null
    ? 'NULL::timestamptz AS last_played_at'
    : 'hist.last_played_at';

  return `
  SELECT
    t.id,
    t.title,
    t.album_id,
    al.title AS album_title,
    al.year,
    COALESCE(t.genre, al.genre) AS genre,
    al.cover_art_url,
    t.track_number,
    t.disc_number,
    t.duration_seconds::float8 AS duration_seconds,
    t.available,
    t.publication_state,
    t.deleted_at,
    t.created_at,
    t.isrc,
    t.musicbrainz_track_id,
    COALESCE(${dateAddedExpr}, t.created_at) AS date_added,
    ${favoriteSelect},
    ${playCountSelect},
    ${lastPlayedSelect},
    COALESCE((
      SELECT json_agg(json_build_object(
        'name', ar.name,
        'image_url', ar.image_url
      ) ORDER BY ta.position, ar.name)
      FROM track_artists ta
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ta.track_id = t.id
    ), '[]'::json) AS artists,
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', aa.id,
        'storage_key', aa.storage_key,
        'container', aa.container,
        'codec', aa.codec,
        'sample_rate_hz', aa.sample_rate_hz,
        'bit_depth', aa.bit_depth,
        'channels', aa.channels,
        'bitrate_kbps', aa.bitrate_kbps,
        'duration_seconds', aa.duration_seconds::float8,
        'file_size_bytes', aa.file_size_bytes,
        'is_lossless', aa.is_lossless,
        'hi_res', aa.hi_res,
        'is_dsd', aa.is_dsd,
        'dsd_rate', aa.dsd_rate,
        'is_mqa', aa.is_mqa,
        'mqa_status', aa.mqa_status,
        'replaygain_track_gain', aa.replaygain_track_gain,
        'replaygain_track_peak', aa.replaygain_track_peak,
        'replaygain_album_gain', aa.replaygain_album_gain,
        'replaygain_album_peak', aa.replaygain_album_peak,
        'checksum', aa.checksum,
        'available', aa.available
      ) ORDER BY aa.is_lossless DESC, aa.sample_rate_hz DESC, aa.bit_depth DESC NULLS LAST)
      FROM audio_assets aa
      WHERE aa.track_id = t.id
    ), '[]'::json) AS assets
  FROM tracks t
  LEFT JOIN albums al ON al.id = t.album_id
  ${userJoins}
`;
}

function jsonArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function toSelectable(asset: JsonAsset): SelectableAsset {
  const sampleRateHz = toNumber(asset.sample_rate_hz);
  const bitDepth = asset.bit_depth == null ? null : toNumber(asset.bit_depth);
  const isLossless = Boolean(asset.is_lossless);
  const classified = classifyAudio({
    codec: asset.codec,
    container: asset.container,
    sampleRateHz,
    bitDepth,
    isLossless,
  });
  return {
    id: asset.id,
    storageKey: asset.storage_key,
    container: asset.container,
    codec: asset.codec,
    sampleRateHz,
    bitDepth,
    channels: toNumber(asset.channels),
    bitrateKbps: asset.bitrate_kbps == null ? null : toNumber(asset.bitrate_kbps),
    durationSeconds: toNumber(asset.duration_seconds),
    fileSizeBytes: asset.file_size_bytes == null ? undefined : toNumber(asset.file_size_bytes),
    isLossless,
    hiRes: classified.hiRes || Boolean(asset.hi_res),
    isDsd: classified.dsd || Boolean(asset.is_dsd),
    dsdRate: classified.dsdRate ?? (asset.dsd_rate == null ? null : toNumber(asset.dsd_rate)),
    isMqa: Boolean(asset.is_mqa),
    mqaStatus: asset.mqa_status ?? null,
    replaygainTrackGain: asset.replaygain_track_gain == null ? null : toNumber(asset.replaygain_track_gain),
    replaygainTrackPeak: asset.replaygain_track_peak == null ? null : toNumber(asset.replaygain_track_peak),
    replaygainAlbumGain: asset.replaygain_album_gain == null ? null : toNumber(asset.replaygain_album_gain),
    replaygainAlbumPeak: asset.replaygain_album_peak == null ? null : toNumber(asset.replaygain_album_peak),
    available: asset.available,
  };
}

export function pickDisplayAsset(assets: JsonAsset[]): DisplayAsset | null {
  const selectable = jsonArray(assets).map(toSelectable).filter((asset) => asset.available);
  if (selectable.length === 0) return null;
  const best = selectable.reduce((winner, asset) =>
    fidelityScore(asset) > fidelityScore(winner) ? asset : winner,
  );
  return {
    container: best.container,
    codec: best.codec,
    sampleRateHz: best.sampleRateHz,
    bitDepth: best.bitDepth,
    channels: best.channels,
    bitrateKbps: best.bitrateKbps,
    lossless: best.isLossless,
    hiRes: best.hiRes ?? null,
    dsdRate: best.dsdRate ?? null,
    isMqa: Boolean(best.isMqa),
    mqaStatus: best.mqaStatus ?? null,
    replaygainTrackGain: best.replaygainTrackGain ?? null,
    replaygainTrackPeak: best.replaygainTrackPeak ?? null,
    replaygainAlbumGain: best.replaygainAlbumGain ?? null,
    replaygainAlbumPeak: best.replaygainAlbumPeak ?? null,
  };
}

function pickChecksum(assets: JsonAsset[]): string | null {
  const selectable = jsonArray(assets).map(toSelectable).filter((asset) => asset.available);
  if (selectable.length === 0) return null;
  const best = selectable.reduce((winner, asset) =>
    fidelityScore(asset) > fidelityScore(winner) ? asset : winner,
  );
  const checksum = jsonArray(assets).find((asset) => asset.id === best.id)?.checksum?.trim().toLowerCase();
  return checksum && /^[0-9a-f]{64}$/.test(checksum) ? checksum : null;
}

function lastPlayedIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTrack(row: TrackQueryRow): FrontendTrack {
  return toFrontendTrack({
    id: row.id,
    title: row.title,
    albumTitle: row.album_title,
    durationSeconds: toNumber(row.duration_seconds),
    trackNumber: row.track_number,
    discNumber: row.disc_number,
    year: row.year,
    genre: row.genre,
    dateAdded: row.date_added,
    coverArtUrl: row.cover_art_url,
    artists: jsonArray(row.artists) as NamedArtist[],
    displayAsset: pickDisplayAsset(jsonArray(row.assets)),
    isrc: row.isrc,
    musicbrainzTrackId: row.musicbrainz_track_id,
    checksumSha256: pickChecksum(jsonArray(row.assets)),
    userState: {
      isFavorite: Boolean(row.is_favorite),
      playCount: toNumber(row.play_count ?? 0),
      lastPlayedAt: lastPlayedIso(row.last_played_at),
    },
  });
}

export interface TrackRecord {
  track: FrontendTrack;
  available: boolean;
  publicationState: 'draft' | 'published';
  deletedAt: Date | string | null;
  assets: SelectableAsset[];
}

export class CatalogRepository {
  constructor(private readonly db: Queryable) {}

  async getTrackRecord(trackId: string, userId?: string): Promise<TrackRecord | null> {
    const userIdParam = userId ? 2 : null;
    const sql = trackSelectSql('t.created_at', userIdParam) + ' WHERE t.id = $1';
    const result = await query<TrackQueryRow>(
      this.db,
      sql,
      userId ? [trackId, userId] : [trackId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      track: mapTrack(row),
      available: row.available,
      publicationState: row.publication_state,
      deletedAt: row.deleted_at,
      assets: jsonArray(row.assets).map(toSelectable),
    };
  }

  async getTrack(trackId: string, userId?: string): Promise<FrontendTrack> {
    const record = await this.getTrackRecord(trackId, userId);
    if (!record || record.deletedAt || record.publicationState !== 'published') {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
    }
    return record.track;
  }

  async getTrackRecordsByIds(
    trackIds: string[],
    dateAddedByTrack?: Map<string, Date | string>,
    userId?: string,
  ): Promise<Map<string, TrackRecord>> {
    const records = new Map<string, TrackRecord>();
    if (trackIds.length === 0) return records;
    const userIdParam = userId ? 2 : null;
    const sql = trackSelectSql('t.created_at', userIdParam) + ' WHERE t.id = ANY($1::uuid[])';
    const result = await query<TrackQueryRow>(
      this.db,
      sql,
      userId ? [trackIds, userId] : [trackIds],
    );
    for (const row of result.rows) {
      const dateAdded = dateAddedByTrack?.get(row.id);
      if (dateAdded) row.date_added = dateAdded;
      records.set(row.id, {
        track: mapTrack(row),
        available: row.available,
        publicationState: row.publication_state,
        deletedAt: row.deleted_at,
        assets: jsonArray(row.assets).map(toSelectable),
      });
    }
    return records;
  }

  async getTracksByIds(
    trackIds: string[],
    dateAddedByTrack?: Map<string, Date | string>,
    userId?: string,
  ): Promise<FrontendTrack[]> {
    const records = await this.getTrackRecordsByIds(trackIds, dateAddedByTrack, userId);
    return trackIds.flatMap((id) => {
      const record = records.get(id);
      if (!record || record.deletedAt || record.publicationState !== 'published') {
        return [];
      }
      return [record.track];
    });
  }

  async listPublishedTracks(
    userId?: string,
    page?: { limit?: number; cursor?: string },
  ): Promise<FrontendTrack[] | { items: FrontendTrack[]; next_cursor: string | null; has_more: boolean }> {
    const userIdParam = userId ? 1 : null;
    if (page?.limit == null && page?.cursor == null) {
      const sql = trackSelectSql('t.created_at', userIdParam)
        + ` WHERE t.publication_state = 'published' AND t.deleted_at IS NULL
            ORDER BY al.title NULLS LAST, t.disc_number NULLS FIRST, t.track_number NULLS FIRST, t.title, t.id`;
      const result = await query<TrackQueryRow>(
        this.db,
        sql,
        userId ? [userId] : [],
      );
      return result.rows.map(mapTrack);
    }

    const limit = parseLimit(page?.limit, 50, 200);
    const cursor = page?.cursor ? decodeCursor<{ title: string; id: string }>(page.cursor) : null;
    const userIdParamPaged = userId ? (cursor ? 3 : 1) : null;
    const sql = trackSelectSql('t.created_at', userIdParamPaged)
      + ` WHERE t.publication_state = 'published' AND t.deleted_at IS NULL
          ${cursor ? 'AND (lower(t.title), t.id) > (lower($1), $2::uuid)' : ''}
          ORDER BY lower(t.title), t.id
          LIMIT ${limit + 1}`;
    const params = cursor
      ? (userId ? [cursor.title, cursor.id, userId] : [cursor.title, cursor.id])
      : (userId ? [userId] : []);
    const result = await query<TrackQueryRow>(this.db, sql, params);
    const rows = result.rows.map(mapTrack);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      next_cursor: hasMore && last ? encodeCursor({ title: last.title, id: last.id }) : null,
      has_more: hasMore,
    };
  }

  async listPublishedArtists(page?: { limit?: number; cursor?: string }): Promise<{
    items: FrontendArtist[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    const limit = parseLimit(page?.limit, 50, 200);
    const cursor = page?.cursor ? decodeCursor<{ sortName: string; id: string }>(page.cursor) : null;
    const result = await query<{
      id: string;
      name: string;
      sort_name: string;
      image_url: string | null;
      track_count: string | number;
      album_count: string | number;
      genres: string[] | null;
    }>(this.db, `
      SELECT
        ar.id,
        ar.name,
        ar.sort_name,
        ar.image_url,
        (
          SELECT COUNT(*)::int
          FROM track_artists ta
          JOIN tracks t ON t.id = ta.track_id
          WHERE ta.artist_id = ar.id AND t.publication_state = 'published' AND t.deleted_at IS NULL
        ) AS track_count,
        (
          SELECT COUNT(*)::int FROM albums al WHERE al.primary_artist_id = ar.id
        ) AS album_count,
        COALESCE((
          SELECT array_agg(DISTINCT genre) FILTER (WHERE genre IS NOT NULL)
          FROM (
            SELECT al.genre FROM albums al WHERE al.primary_artist_id = ar.id
            UNION
            SELECT t.genre
            FROM track_artists ta
            JOIN tracks t ON t.id = ta.track_id
            WHERE ta.artist_id = ar.id
          ) genres
        ), ARRAY[]::text[]) AS genres
      FROM artists ar
      WHERE EXISTS (
        SELECT 1 FROM track_artists ta
        JOIN tracks t ON t.id = ta.track_id
        WHERE ta.artist_id = ar.id AND t.publication_state = 'published' AND t.deleted_at IS NULL
      )
      ${cursor ? 'AND (ar.sort_name, ar.id) > ($1, $2::uuid)' : ''}
      ORDER BY ar.sort_name, ar.id
      LIMIT ${limit + 1}
    `, cursor ? [cursor.sortName, cursor.id] : []);

    const mapped = result.rows.map((artist) => ({
      id: artist.id,
      name: artist.name,
      image_url: artist.image_url,
      track_count: toNumber(artist.track_count),
      album_count: toNumber(artist.album_count),
      albums: [] as FrontendAlbum[],
      genres: artist.genres ?? [],
      sort_name: artist.sort_name,
    }));
    const hasMore = mapped.length > limit;
    const items = hasMore ? mapped.slice(0, limit) : mapped;
    const last = items[items.length - 1];
    return {
      items: items.map(({ sort_name: _sort, ...artist }) => artist),
      next_cursor: hasMore && last
        ? encodeCursor({ sortName: last.sort_name, id: last.id })
        : null,
      has_more: hasMore,
    };
  }

  async listPublishedAlbums(page?: { limit?: number; cursor?: string }): Promise<{
    items: FrontendAlbum[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    const limit = parseLimit(page?.limit, 50, 200);
    const cursor = page?.cursor ? decodeCursor<{ title: string; id: string }>(page.cursor) : null;
    const result = await query<{
      id: string;
      title: string;
      year: number | null;
      genre: string | null;
      cover_art_url: string | null;
      artist_name: string | null;
      track_count: string | number;
      total_duration: string | number;
    }>(this.db, `
      SELECT
        al.id,
        al.title,
        al.year,
        al.genre,
        al.cover_art_url,
        ar.name AS artist_name,
        COUNT(t.id)::int AS track_count,
        COALESCE(SUM(t.duration_seconds), 0)::float8 AS total_duration
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.primary_artist_id
      LEFT JOIN tracks t ON t.album_id = al.id
        AND t.publication_state = 'published' AND t.deleted_at IS NULL
      WHERE EXISTS (
        SELECT 1 FROM tracks t2
        WHERE t2.album_id = al.id AND t2.publication_state = 'published' AND t2.deleted_at IS NULL
      )
      ${cursor ? 'AND (lower(al.title), al.id) > (lower($1), $2::uuid)' : ''}
      GROUP BY al.id, ar.name
      ORDER BY lower(al.title), al.id
      LIMIT ${limit + 1}
    `, cursor ? [cursor.title, cursor.id] : []);

    const mapped = result.rows.map((album) => ({
      id: album.id,
      name: album.title,
      artist: album.artist_name ?? 'Unknown Artist',
      year: album.year,
      genre: album.genre,
      track_count: toNumber(album.track_count),
      total_duration: toNumber(album.total_duration),
      cover_url: album.cover_art_url,
      tracks: [] as FrontendTrack[],
    }));
    const hasMore = mapped.length > limit;
    const items = hasMore ? mapped.slice(0, limit) : mapped;
    const last = items[items.length - 1];
    return {
      items,
      next_cursor: hasMore && last ? encodeCursor({ title: last.name, id: last.id }) : null,
      has_more: hasMore,
    };
  }

  async publishedStats(): Promise<FrontendLibraryStats> {
    const result = await query<{
      total_tracks: string | number;
      total_albums: string | number;
      total_artists: string | number;
      total_duration_secs: string | number;
      total_size_bytes: string | number;
    }>(this.db, `
      SELECT
        COUNT(t.id)::int AS total_tracks,
        COUNT(DISTINCT t.album_id)::int AS total_albums,
        COALESCE((
          SELECT COUNT(DISTINCT ta.artist_id)::int
          FROM track_artists ta
          JOIN tracks t2 ON t2.id = ta.track_id
          WHERE t2.publication_state = 'published' AND t2.deleted_at IS NULL
        ), 0) AS total_artists,
        COALESCE(SUM(t.duration_seconds), 0)::float8 AS total_duration_secs,
        COALESCE(SUM(best.file_size_bytes), 0)::bigint AS total_size_bytes
      FROM tracks t
      LEFT JOIN LATERAL (
        SELECT aa.file_size_bytes
        FROM audio_assets aa
        WHERE aa.track_id = t.id AND aa.available = TRUE
        ORDER BY aa.is_lossless DESC,
                 (aa.sample_rate_hz * COALESCE(aa.bit_depth, 16) * aa.channels) DESC
        LIMIT 1
      ) best ON TRUE
      WHERE t.publication_state = 'published' AND t.deleted_at IS NULL
    `);

    const row = result.rows[0];
    if (!row) return emptyLibraryStats();
    return {
      total_tracks: toNumber(row.total_tracks),
      total_artists: toNumber(row.total_artists),
      total_albums: toNumber(row.total_albums),
      total_duration_secs: toNumber(row.total_duration_secs),
      total_size_bytes: toNumber(row.total_size_bytes),
    };
  }

  async getAlbum(albumId: string, includeTracks: boolean, userId?: string): Promise<FrontendAlbum> {
    const albumResult = await query<{
      id: string;
      title: string;
      year: number | null;
      genre: string | null;
      cover_art_url: string | null;
      artist_name: string | null;
      track_count: string | number;
      total_duration: string | number;
    }>(this.db, `
      SELECT
        al.id,
        al.title,
        al.year,
        al.genre,
        al.cover_art_url,
        ar.name AS artist_name,
        COUNT(t.id)::int AS track_count,
        COALESCE(SUM(t.duration_seconds), 0)::float8 AS total_duration
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.primary_artist_id
      LEFT JOIN tracks t ON t.album_id = al.id
        AND t.publication_state = 'published' AND t.deleted_at IS NULL
      WHERE al.id = $1
      GROUP BY al.id, ar.name
    `, [albumId]);

    const album = albumResult.rows[0];
    if (!album) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Album not found.');
    }

    const tracks = includeTracks ? await this.listAlbumTracks(albumId, userId) : [];
    return {
      id: album.id,
      name: album.title,
      artist: album.artist_name ?? 'Unknown Artist',
      year: album.year,
      genre: album.genre,
      track_count: toNumber(album.track_count),
      total_duration: toNumber(album.total_duration),
      cover_url: album.cover_art_url,
      tracks,
    };
  }

  async listAlbumTracks(albumId: string, userId?: string): Promise<FrontendTrack[]> {
    const exists = await query(this.db, 'SELECT 1 FROM albums WHERE id = $1', [albumId]);
    if ((exists.rowCount ?? 0) === 0) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Album not found.');
    }
    const userIdParam = userId ? 2 : null;
    const sql = trackSelectSql('t.created_at', userIdParam)
      + ` WHERE t.album_id = $1 AND t.publication_state = 'published' AND t.deleted_at IS NULL
          ORDER BY t.disc_number NULLS FIRST, t.track_number NULLS FIRST, t.title`;
    const result = await query<TrackQueryRow>(
      this.db,
      sql,
      userId ? [albumId, userId] : [albumId],
    );
    return result.rows.map(mapTrack);
  }

  async getArtist(artistId: string): Promise<FrontendArtist> {
    const artistResult = await query<{
      id: string;
      name: string;
      image_url: string | null;
      track_count: string | number;
      album_count: string | number;
      genres: string[] | null;
    }>(this.db, `
      SELECT
        ar.id,
        ar.name,
        ar.image_url,
        (
          SELECT COUNT(*)::int
          FROM track_artists ta
          JOIN tracks t ON t.id = ta.track_id
          WHERE ta.artist_id = ar.id AND t.publication_state = 'published' AND t.deleted_at IS NULL
        ) AS track_count,
        (
          SELECT COUNT(*)::int FROM albums al WHERE al.primary_artist_id = ar.id
        ) AS album_count,
        COALESCE((
          SELECT array_agg(DISTINCT genre) FILTER (WHERE genre IS NOT NULL)
          FROM (
            SELECT al.genre FROM albums al WHERE al.primary_artist_id = ar.id
            UNION
            SELECT t.genre
            FROM track_artists ta
            JOIN tracks t ON t.id = ta.track_id
            WHERE ta.artist_id = ar.id
          ) genres
        ), ARRAY[]::text[]) AS genres
      FROM artists ar
      WHERE ar.id = $1
    `, [artistId]);

    const artist = artistResult.rows[0];
    if (!artist) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Artist not found.');
    }

    const albums = await this.listArtistAlbums(artistId);
    return {
      id: artist.id,
      name: artist.name,
      image_url: artist.image_url,
      track_count: toNumber(artist.track_count),
      album_count: toNumber(artist.album_count),
      albums,
      genres: artist.genres ?? [],
    };
  }

  async listArtistAlbums(artistId: string): Promise<FrontendAlbum[]> {
    const exists = await query(this.db, 'SELECT 1 FROM artists WHERE id = $1', [artistId]);
    if ((exists.rowCount ?? 0) === 0) {
      throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Artist not found.');
    }

    const result = await query<{
      id: string;
      title: string;
      year: number | null;
      genre: string | null;
      cover_art_url: string | null;
      artist_name: string | null;
      track_count: string | number;
      total_duration: string | number;
    }>(this.db, `
      SELECT
        al.id,
        al.title,
        al.year,
        al.genre,
        al.cover_art_url,
        ar.name AS artist_name,
        COUNT(t.id)::int AS track_count,
        COALESCE(SUM(t.duration_seconds), 0)::float8 AS total_duration
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.primary_artist_id
      LEFT JOIN tracks t ON t.album_id = al.id
        AND t.publication_state = 'published' AND t.deleted_at IS NULL
      WHERE al.primary_artist_id = $1
         OR al.id IN (
           SELECT t2.album_id
           FROM track_artists ta
           JOIN tracks t2 ON t2.id = ta.track_id
           WHERE ta.artist_id = $1 AND t2.album_id IS NOT NULL
         )
      GROUP BY al.id, ar.name
      ORDER BY al.year NULLS LAST, al.title
    `, [artistId]);

    return result.rows.map((album) => ({
      id: album.id,
      name: album.title,
      artist: album.artist_name ?? 'Unknown Artist',
      year: album.year,
      genre: album.genre,
      track_count: toNumber(album.track_count),
      total_duration: toNumber(album.total_duration),
      cover_url: album.cover_art_url,
      tracks: [],
    }));
  }

  async search(input: CatalogSearchQuery, userId?: string): Promise<SearchPage> {
    const q = input.q?.trim() ?? '';
    const type = input.type ?? 'all';
    const limit = parseLimit(input.limit, 20, 50);
    if (!q) {
      return { items: [], next_cursor: null, has_more: false };
    }

    const cursor = input.cursor ? decodeCursor<SearchCursor>(input.cursor) : null;
    const pattern = `%${q}%`;
    const types = type === 'all' ? ['artist', 'album', 'track'] : [type];

    const result = await query<{
      entity_type: 'artist' | 'album' | 'track';
      id: string;
      sort_name: string;
      payload: unknown;
    }>(this.db, `
      WITH hits AS (
        SELECT 'artist'::text AS entity_type, ar.id, ar.sort_name,
          json_build_object(
            'id', ar.id,
            'name', ar.name,
            'image_url', ar.image_url,
            'track_count', (
              SELECT COUNT(*)::int FROM track_artists ta
              JOIN tracks t ON t.id = ta.track_id
              WHERE ta.artist_id = ar.id AND t.publication_state = 'published' AND t.deleted_at IS NULL
            ),
            'album_count', (SELECT COUNT(*)::int FROM albums al WHERE al.primary_artist_id = ar.id)
          ) AS payload
        FROM artists ar
        WHERE ar.name ILIKE $1

        UNION ALL

        SELECT 'album', al.id, al.title,
          json_build_object(
            'id', al.id,
            'name', al.title,
            'artist', COALESCE(ar.name, 'Unknown Artist'),
            'year', al.year,
            'track_count', (
              SELECT COUNT(*)::int FROM tracks t
              WHERE t.album_id = al.id AND t.publication_state = 'published' AND t.deleted_at IS NULL
            ),
            'total_duration', COALESCE((
              SELECT SUM(t.duration_seconds)::float8 FROM tracks t
              WHERE t.album_id = al.id AND t.publication_state = 'published' AND t.deleted_at IS NULL
            ), 0),
            'cover_url', al.cover_art_url
          )
        FROM albums al
        LEFT JOIN artists ar ON ar.id = al.primary_artist_id
        WHERE al.title ILIKE $1 OR ar.name ILIKE $1

        UNION ALL

        SELECT 'track', t.id, t.title,
          json_build_object('id', t.id)
        FROM tracks t
        LEFT JOIN albums al ON al.id = t.album_id
        LEFT JOIN artists ar ON ar.id = al.primary_artist_id
        WHERE t.publication_state = 'published' AND t.deleted_at IS NULL
          AND (t.title ILIKE $1 OR al.title ILIKE $1 OR ar.name ILIKE $1)
           OR EXISTS (
             SELECT 1 FROM track_artists ta
             JOIN artists tar ON tar.id = ta.artist_id
             WHERE ta.track_id = t.id AND tar.name ILIKE $1
           )
      )
      SELECT entity_type, id, sort_name, payload
      FROM hits
      WHERE entity_type = ANY($2::text[])
        AND (
          $3::text IS NULL
          OR (sort_name, id::text) > ($3::text, $4::text)
        )
      ORDER BY sort_name, id::text
      LIMIT $5
    `, [pattern, types, cursor?.sortName ?? null, cursor?.id ?? null, limit + 1]);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    const trackIds = rows.filter((row) => row.entity_type === 'track').map((row) => row.id);
    const tracks = await this.getTracksByIds(trackIds, undefined, userId);
    const tracksById = new Map(tracks.map((track) => [track.id, track]));

    const items: SearchResultItem[] = [];
    for (const row of rows) {
      if (row.entity_type === 'artist') {
        items.push({ type: 'artist', id: row.id, artist: row.payload as SearchArtistHit });
      } else if (row.entity_type === 'album') {
        items.push({ type: 'album', id: row.id, album: row.payload as SearchAlbumHit });
      } else {
        const track = tracksById.get(row.id);
        if (track) items.push({ type: 'track', id: row.id, track });
      }
    }

    const last = rows[rows.length - 1];
    return {
      items,
      next_cursor: hasMore && last
        ? encodeCursor({ sortName: last.sort_name, id: last.id } satisfies SearchCursor)
        : null,
      has_more: hasMore,
    };
  }

  async resolveArtistByName(artistName: string): Promise<{ id: string; name: string }> {
    const normalized = normalizeCatalogName(artistName);
    if (!normalized) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'artist_name is required.');
    }
    const result = await query<{ id: string; name: string }>(this.db, `
      SELECT id, name
      FROM artists
      WHERE lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = $1
      ORDER BY id
    `, [normalized]);

    if (result.rows.length === 0) {
      throw new AppError(404, ErrorCodes.FAVORITE_NOT_FOUND, 'Artist not found.');
    }
    if (result.rows.length > 1) {
      throw new AppError(409, ErrorCodes.FAVORITE_AMBIGUOUS, 'Artist name matches more than one catalog artist.');
    }
    const artist = result.rows[0];
    if (!artist) {
      throw new AppError(404, ErrorCodes.FAVORITE_NOT_FOUND, 'Artist not found.');
    }
    return artist;
  }

  async resolveAlbumByTitleAndArtist(
    albumTitle: string,
    artistName: string,
  ): Promise<{ id: string; title: string; artistName: string }> {
    const albumNorm = normalizeCatalogName(albumTitle);
    const artistNorm = normalizeCatalogName(artistName);
    if (!albumNorm) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'album_title is required.');
    }
    if (!artistNorm) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'artist_name is required.');
    }

    const result = await query<{ id: string; title: string; artist_name: string }>(this.db, `
      SELECT al.id, al.title, ar.name AS artist_name
      FROM albums al
      JOIN artists ar ON ar.id = al.primary_artist_id
      WHERE lower(btrim(regexp_replace(al.title, '\\s+', ' ', 'g'))) = $1
        AND lower(btrim(regexp_replace(ar.name, '\\s+', ' ', 'g'))) = $2
      ORDER BY al.id
    `, [albumNorm, artistNorm]);

    if (result.rows.length === 0) {
      throw new AppError(404, ErrorCodes.FAVORITE_NOT_FOUND, 'Album not found.');
    }
    if (result.rows.length > 1) {
      throw new AppError(409, ErrorCodes.FAVORITE_AMBIGUOUS, 'Album title and artist match more than one catalog album.');
    }
    const album = result.rows[0];
    if (!album) {
      throw new AppError(404, ErrorCodes.FAVORITE_NOT_FOUND, 'Album not found.');
    }
    return { id: album.id, title: album.title, artistName: album.artist_name };
  }

  async trackExists(trackId: string): Promise<boolean> {
    const result = await query(
      this.db,
      `SELECT 1 FROM tracks
       WHERE id = $1 AND publication_state = 'published' AND deleted_at IS NULL`,
      [trackId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getTrackDurationSeconds(trackId: string): Promise<number | null> {
    const result = await query<{ duration_seconds: string | number }>(
      this.db,
      'SELECT duration_seconds::float8 AS duration_seconds FROM tracks WHERE id = $1 AND publication_state = \'published\' AND deleted_at IS NULL',
      [trackId],
    );
    const row = result.rows[0];
    return row ? toNumber(row.duration_seconds) : null;
  }
}

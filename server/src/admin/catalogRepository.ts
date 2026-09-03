import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types.js';
import { query, toIso, toNumber } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';

export interface AdminArtistRow {
  id: string;
  name: string;
  sort_name: string;
  image_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const ARTIST_COLUMNS = 'id, name, sort_name, image_url, created_at, updated_at';

export interface AdminAlbumRow {
  id: string;
  title: string;
  primary_artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_art_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AdminTrackRow {
  id: string;
  title: string;
  album_id: string | null;
  album_title: string | null;
  track_number: number | null;
  disc_number: number | null;
  duration_seconds: number | string;
  genre: string | null;
  available: boolean;
  publication_state: 'draft' | 'published';
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AdminAssetRow {
  id: string;
  track_id: string;
  storage_key: string;
  container: string;
  codec: string;
  mime_type: string | null;
  sample_rate_hz: number;
  bit_depth: number | null;
  channels: number;
  bitrate_kbps: number | null;
  duration_seconds: number | string;
  file_size_bytes: string | number;
  checksum: string;
  is_lossless: boolean;
  available: boolean;
  validation_state: string;
  source_upload_id: string | null;
}

export interface AdminRightsRow {
  track_id: string;
  rights_holder: string;
  license_source_ref: string;
  territory_scope: string | null;
  attested: boolean;
  attested_by: string | null;
  attested_at: Date | string | null;
}

export interface AdminIngestionSummary {
  latest_upload_id: string | null;
  latest_upload_status: string | null;
  latest_job_id: string | null;
  latest_job_status: string | null;
  latest_job_error: string | null;
}

export class AdminCatalogRepository {
  constructor(private readonly db: Queryable) {}

  async listArtists(q?: string, limit = 50): Promise<AdminArtistRow[]> {
    const pattern = q?.trim() ? `%${q.trim()}%` : null;
    const result = await query<AdminArtistRow>(this.db, `
      SELECT ${ARTIST_COLUMNS}
      FROM artists
      WHERE $1::text IS NULL OR name ILIKE $1
      ORDER BY sort_name, name
      LIMIT $2
    `, [pattern, limit]);
    return result.rows;
  }

  async getArtist(id: string): Promise<AdminArtistRow | null> {
    const result = await query<AdminArtistRow>(
      this.db,
      `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findRepresentativeAlbumTitle(artistId: string): Promise<string | null> {
    const result = await query<{ title: string }>(this.db, `
      SELECT al.title
      FROM albums al
      LEFT JOIN tracks t ON t.album_id = al.id AND t.deleted_at IS NULL
      LEFT JOIN track_artists ta ON ta.track_id = t.id AND ta.artist_id = $1
      WHERE (al.primary_artist_id = $1 OR ta.artist_id = $1)
        AND (al.placeholder_kind IS NULL OR al.placeholder_kind <> 'unknown_album')
      GROUP BY al.id, al.title
      ORDER BY count(DISTINCT t.id) DESC, lower(al.title), al.id
      LIMIT 1
    `, [artistId]);
    return result.rows[0]?.title ?? null;
  }

  async listArtistsMissingImage(limit = 50): Promise<AdminArtistRow[]> {
    const result = await query<AdminArtistRow>(this.db, `
      SELECT ${ARTIST_COLUMNS}
      FROM artists
      WHERE (placeholder_kind IS NULL OR placeholder_kind <> 'unknown_artist')
        AND (
          image_url IS NULL
          OR btrim(image_url) = ''
          OR artists.image_url ILIKE '%/image/thumb/Music%'
          OR EXISTS (
            SELECT 1
            FROM albums al
            WHERE al.primary_artist_id = artists.id
              AND al.cover_art_url IS NOT NULL
              AND btrim(al.cover_art_url) = btrim(artists.image_url)
          )
        )
      ORDER BY sort_name, name
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async artistImageMatchesOwnAlbumCover(artistId: string, imageUrl: string | null): Promise<boolean> {
    if (!imageUrl?.trim()) return false;
    const result = await query<{ n: number }>(this.db, `
      SELECT count(*)::int AS n
      FROM albums
      WHERE primary_artist_id = $1
        AND cover_art_url IS NOT NULL
        AND btrim(cover_art_url) = btrim($2)
    `, [artistId, imageUrl]);
    return (result.rows[0]?.n ?? 0) > 0;
  }

  async insertArtist(id: string, name: string, sortName: string, options?: {
    musicbrainzArtistId?: string | null;
    placeholderKind?: string | null;
  }): Promise<AdminArtistRow> {
    const result = await query<AdminArtistRow>(this.db, `
      INSERT INTO artists (id, name, sort_name, musicbrainz_artist_id, placeholder_kind)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${ARTIST_COLUMNS}
    `, [id, name, sortName, options?.musicbrainzArtistId ?? null, options?.placeholderKind ?? null]);
    return result.rows[0]!;
  }

  async ensurePlaceholderArtist(kind: string, name: string, sortName: string): Promise<AdminArtistRow> {
    const existing = await query<AdminArtistRow>(this.db, `
      SELECT ${ARTIST_COLUMNS}
      FROM artists
      WHERE placeholder_kind = $1
      ORDER BY created_at, id
      LIMIT 1
    `, [kind]);
    if (existing.rows[0]) return existing.rows[0];
    try {
      return await this.insertArtist(randomUUID(), name, sortName, { placeholderKind: kind });
    } catch {
      const retry = await query<AdminArtistRow>(this.db, `
        SELECT ${ARTIST_COLUMNS}
        FROM artists
        WHERE placeholder_kind = $1
        ORDER BY created_at, id
        LIMIT 1
      `, [kind]);
      if (retry.rows[0]) return retry.rows[0];
      throw new Error('failed to ensure placeholder artist');
    }
  }

  async updateArtist(id: string, patch: {
    name?: string;
    sortName?: string;
    imageUrl?: string | null;
  }): Promise<AdminArtistRow | null> {
    const current = await this.getArtist(id);
    if (!current) return null;
    const result = await query<AdminArtistRow>(this.db, `
      UPDATE artists
      SET name = $2, sort_name = $3, image_url = $4, updated_at = timezone('utc', now())
      WHERE id = $1
      RETURNING ${ARTIST_COLUMNS}
    `, [
      id,
      patch.name ?? current.name,
      patch.sortName ?? current.sort_name,
      patch.imageUrl === undefined ? current.image_url : patch.imageUrl,
    ]);
    return result.rows[0] ?? null;
  }

  async listAlbums(q?: string, limit = 50): Promise<AdminAlbumRow[]> {
    const pattern = q?.trim() ? `%${q.trim()}%` : null;
    const result = await query<AdminAlbumRow>(this.db, `
      SELECT al.id, al.title, al.primary_artist_id, ar.name AS artist_name,
             al.year, al.genre, al.cover_art_url, al.created_at, al.updated_at
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.primary_artist_id
      WHERE $1::text IS NULL OR al.title ILIKE $1 OR ar.name ILIKE $1
      ORDER BY lower(al.title), al.id
      LIMIT $2
    `, [pattern, limit]);
    return result.rows;
  }

  async getAlbum(id: string): Promise<AdminAlbumRow | null> {
    const result = await query<AdminAlbumRow>(this.db, `
      SELECT al.id, al.title, al.primary_artist_id, ar.name AS artist_name,
             al.year, al.genre, al.cover_art_url, al.created_at, al.updated_at
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.primary_artist_id
      WHERE al.id = $1
    `, [id]);
    return result.rows[0] ?? null;
  }

  async listAlbumsMissingCover(limit = 50): Promise<AdminAlbumRow[]> {
    const result = await query<AdminAlbumRow>(this.db, `
      SELECT al.id, al.title, al.primary_artist_id, ar.name AS artist_name,
             al.year, al.genre, al.cover_art_url, al.created_at, al.updated_at
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.primary_artist_id
      WHERE (al.cover_art_url IS NULL OR btrim(al.cover_art_url) = '')
        AND (al.placeholder_kind IS NULL OR al.placeholder_kind <> 'unknown_album')
      ORDER BY lower(al.title), al.id
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async insertAlbum(input: {
    id: string;
    title: string;
    primaryArtistId: string | null;
    year: number | null;
    genre: string | null;
    musicbrainzAlbumId?: string | null;
    upc?: string | null;
    placeholderKind?: string | null;
  }): Promise<AdminAlbumRow> {
    await query(this.db, `
      INSERT INTO albums (id, title, primary_artist_id, year, genre, musicbrainz_album_id, upc, placeholder_kind)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      input.id, input.title, input.primaryArtistId, input.year, input.genre,
      input.musicbrainzAlbumId ?? null, input.upc ?? null, input.placeholderKind ?? null,
    ]);
    const album = await this.getAlbum(input.id);
    if (!album) throw new Error('album insert did not persist');
    return album;
  }

  async ensurePlaceholderAlbum(kind: string, title: string, primaryArtistId: string | null): Promise<AdminAlbumRow> {
    const existing = await query<{ id: string }>(this.db, `
      SELECT id FROM albums WHERE placeholder_kind = $1 ORDER BY created_at, id LIMIT 1
    `, [kind]);
    if (existing.rows[0]) {
      const album = await this.getAlbum(existing.rows[0].id);
      if (album) return album;
    }
    try {
      return await this.insertAlbum({
        id: randomUUID(),
        title,
        primaryArtistId,
        year: null,
        genre: null,
        placeholderKind: kind,
      });
    } catch {
      const retry = await query<{ id: string }>(this.db, `
        SELECT id FROM albums WHERE placeholder_kind = $1 ORDER BY created_at, id LIMIT 1
      `, [kind]);
      if (retry.rows[0]) {
        const album = await this.getAlbum(retry.rows[0].id);
        if (album) return album;
      }
      throw new Error('failed to ensure placeholder album');
    }
  }

  async updateAlbum(id: string, patch: {
    title?: string;
    primaryArtistId?: string | null;
    year?: number | null;
    genre?: string | null;
    coverArtUrl?: string | null;
  }): Promise<AdminAlbumRow | null> {
    const current = await this.getAlbum(id);
    if (!current) return null;
    await query(this.db, `
      UPDATE albums
      SET title = $2,
          primary_artist_id = $3,
          year = $4,
          genre = $5,
          cover_art_url = $6,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [
      id,
      patch.title ?? current.title,
      patch.primaryArtistId === undefined ? current.primary_artist_id : patch.primaryArtistId,
      patch.year === undefined ? current.year : patch.year,
      patch.genre === undefined ? current.genre : patch.genre,
      patch.coverArtUrl === undefined ? current.cover_art_url : patch.coverArtUrl,
    ]);
    return this.getAlbum(id);
  }

  async listTracks(q?: string, limit = 50): Promise<AdminTrackRow[]> {
    const pattern = q?.trim() ? `%${q.trim()}%` : null;
    const result = await query<AdminTrackRow>(this.db, `
      SELECT t.id, t.title, t.album_id, al.title AS album_title, t.track_number, t.disc_number,
             t.duration_seconds::float8 AS duration_seconds, t.genre, t.available,
             t.publication_state, t.deleted_at, t.created_at, t.updated_at
      FROM tracks t
      LEFT JOIN albums al ON al.id = t.album_id
      WHERE t.deleted_at IS NULL
        AND ($1::text IS NULL OR t.title ILIKE $1 OR al.title ILIKE $1)
      ORDER BY t.updated_at DESC, t.title
      LIMIT $2
    `, [pattern, limit]);
    return result.rows;
  }

  async getTrack(id: string): Promise<AdminTrackRow | null> {
    const result = await query<AdminTrackRow>(this.db, `
      SELECT t.id, t.title, t.album_id, al.title AS album_title, t.track_number, t.disc_number,
             t.duration_seconds::float8 AS duration_seconds, t.genre, t.available,
             t.publication_state, t.deleted_at, t.created_at, t.updated_at
      FROM tracks t
      LEFT JOIN albums al ON al.id = t.album_id
      WHERE t.id = $1
    `, [id]);
    return result.rows[0] ?? null;
  }

  async insertTrack(input: {
    id: string;
    title: string;
    albumId: string | null;
    trackNumber: number | null;
    discNumber: number | null;
    genre: string | null;
    durationSeconds?: number;
    isrc?: string | null;
    musicbrainzTrackId?: string | null;
  }): Promise<AdminTrackRow> {
    await query(this.db, `
      INSERT INTO tracks (
        id, title, album_id, track_number, disc_number, duration_seconds, genre,
        available, publication_state, isrc, musicbrainz_track_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, 'draft', $8, $9)
    `, [
      input.id, input.title, input.albumId, input.trackNumber, input.discNumber,
      input.durationSeconds ?? 0, input.genre,
      input.isrc ?? null, input.musicbrainzTrackId ?? null,
    ]);
    const track = await this.getTrack(input.id);
    if (!track) throw new Error('track insert did not persist');
    return track;
  }

  async updateTrack(id: string, patch: {
    title?: string;
    albumId?: string | null;
    trackNumber?: number | null;
    discNumber?: number | null;
    genre?: string | null;
    durationSeconds?: number;
  }): Promise<AdminTrackRow | null> {
    const current = await this.getTrack(id);
    if (!current || current.deleted_at) return null;
    await query(this.db, `
      UPDATE tracks
      SET title = $2,
          album_id = $3,
          track_number = $4,
          disc_number = $5,
          genre = $6,
          duration_seconds = $7,
          updated_at = timezone('utc', now())
      WHERE id = $1 AND deleted_at IS NULL
    `, [
      id,
      patch.title ?? current.title,
      patch.albumId === undefined ? current.album_id : patch.albumId,
      patch.trackNumber === undefined ? current.track_number : patch.trackNumber,
      patch.discNumber === undefined ? current.disc_number : patch.discNumber,
      patch.genre === undefined ? current.genre : patch.genre,
      patch.durationSeconds === undefined ? toNumber(current.duration_seconds) : patch.durationSeconds,
    ]);
    return this.getTrack(id);
  }

  async replaceTrackArtists(trackId: string, artistIds: string[]): Promise<void> {
    await query(this.db, 'DELETE FROM track_artists WHERE track_id = $1', [trackId]);
    for (const [index, artistId] of artistIds.entries()) {
      await query(this.db, `
        INSERT INTO track_artists (track_id, artist_id, role, position)
        VALUES ($1, $2, 'primary', $3)
      `, [trackId, artistId, index]);
    }
  }

  async listTrackArtists(trackId: string): Promise<Array<{ id: string; name: string }>> {
    const result = await query<{ id: string; name: string }>(this.db, `
      SELECT ar.id, ar.name
      FROM track_artists ta
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ta.track_id = $1
      ORDER BY ta.position, ar.name
    `, [trackId]);
    return result.rows;
  }

  async listAssets(trackId: string): Promise<AdminAssetRow[]> {
    const result = await query<AdminAssetRow>(this.db, `
      SELECT id, track_id, storage_key, container, codec, mime_type, sample_rate_hz, bit_depth,
             channels, bitrate_kbps, duration_seconds::float8 AS duration_seconds, file_size_bytes,
             checksum, is_lossless, available, validation_state, source_upload_id
      FROM audio_assets
      WHERE track_id = $1
      ORDER BY is_lossless DESC, sample_rate_hz DESC
    `, [trackId]);
    return result.rows;
  }

  async getRights(trackId: string): Promise<AdminRightsRow | null> {
    const result = await query<AdminRightsRow>(
      this.db,
      'SELECT * FROM track_rights WHERE track_id = $1',
      [trackId],
    );
    return result.rows[0] ?? null;
  }

  async upsertRights(input: {
    trackId: string;
    rightsHolder: string;
    licenseSourceRef: string;
    territoryScope: string | null;
    attested: boolean;
    attestedBy: string | null;
  }): Promise<AdminRightsRow> {
    const result = await query<AdminRightsRow>(this.db, `
      INSERT INTO track_rights (
        track_id, rights_holder, license_source_ref, territory_scope,
        attested, attested_by, attested_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        CASE WHEN $5 THEN timezone('utc', now()) ELSE NULL END
      )
      ON CONFLICT (track_id) DO UPDATE SET
        rights_holder = EXCLUDED.rights_holder,
        license_source_ref = EXCLUDED.license_source_ref,
        territory_scope = EXCLUDED.territory_scope,
        attested = EXCLUDED.attested,
        attested_by = EXCLUDED.attested_by,
        attested_at = CASE
          WHEN EXCLUDED.attested THEN timezone('utc', now())
          ELSE NULL
        END,
        updated_at = timezone('utc', now())
      RETURNING *
    `, [
      input.trackId,
      input.rightsHolder,
      input.licenseSourceRef,
      input.territoryScope,
      input.attested,
      input.attestedBy,
    ]);
    return result.rows[0]!;
  }

  async ingestionSummary(trackId: string): Promise<AdminIngestionSummary> {
    const result = await query<AdminIngestionSummary>(this.db, `
      SELECT
        u.id AS latest_upload_id,
        u.status AS latest_upload_status,
        j.id AS latest_job_id,
        j.status AS latest_job_status,
        j.last_error_code AS latest_job_error
      FROM media_uploads u
      LEFT JOIN LATERAL (
        SELECT id, status, last_error_code
        FROM ingestion_jobs
        WHERE upload_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) j ON TRUE
      WHERE u.entity_type = 'track' AND u.entity_id = $1 AND u.media_type = 'audio'
      ORDER BY u.created_at DESC
      LIMIT 1
    `, [trackId]);
    return result.rows[0] ?? {
      latest_upload_id: null,
      latest_upload_status: null,
      latest_job_id: null,
      latest_job_status: null,
      latest_job_error: null,
    };
  }

  async hasReadyAsset(trackId: string): Promise<boolean> {
    const result = await query(this.db, `
      SELECT 1 FROM audio_assets
      WHERE track_id = $1 AND available = TRUE AND validation_state = 'ready'
      LIMIT 1
    `, [trackId]);
    return (result.rowCount ?? 0) > 0;
  }

  async hasBlockingJob(trackId: string): Promise<boolean> {
    const result = await query(this.db, `
      SELECT 1
      FROM media_uploads u
      JOIN ingestion_jobs j ON j.upload_id = u.id
      WHERE u.entity_type = 'track' AND u.entity_id = $1
        AND u.media_type = 'audio'
        AND u.status <> 'cancelled'
        AND j.status IN ('pending', 'probing', 'failed')
      LIMIT 1
    `, [trackId]);
    return (result.rowCount ?? 0) > 0;
  }

  async setPublication(trackId: string, published: boolean): Promise<void> {
    await query(this.db, `
      UPDATE tracks
      SET publication_state = $2,
          available = $3,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [trackId, published ? 'published' : 'draft', published]);
  }

  async trackReferenceCounts(trackId: string): Promise<{
    history: number;
    library: number;
    playlists: number;
  }> {
    const result = await query<{ history: string | number; library: string | number; playlists: string | number }>(this.db, `
      SELECT
        (SELECT COUNT(*)::int FROM play_history WHERE track_id = $1) AS history,
        (SELECT COUNT(*)::int FROM user_library_tracks WHERE track_id = $1) AS library,
        (SELECT COUNT(*)::int FROM playlist_tracks WHERE track_id = $1) AS playlists
    `, [trackId]);
    const row = result.rows[0];
    return {
      history: toNumber(row?.history ?? 0),
      library: toNumber(row?.library ?? 0),
      playlists: toNumber(row?.playlists ?? 0),
    };
  }

  async softDeleteTrack(trackId: string): Promise<void> {
    await query(this.db, `
      UPDATE tracks
      SET deleted_at = timezone('utc', now()),
          publication_state = 'draft',
          available = FALSE,
          updated_at = timezone('utc', now())
      WHERE id = $1
    `, [trackId]);
    await query(this.db, `
      UPDATE audio_assets
      SET available = FALSE, validation_state = 'cancelled', updated_at = timezone('utc', now())
      WHERE track_id = $1
    `, [trackId]);
  }

  async hardDeleteTrack(trackId: string): Promise<void> {
    await query(this.db, 'DELETE FROM tracks WHERE id = $1', [trackId]);
  }

  async findAvailableAssetByChecksum(checksum: string): Promise<AdminAssetRow | null> {
    const result = await query<AdminAssetRow>(this.db, `
      SELECT id, track_id, storage_key, container, codec, mime_type, sample_rate_hz, bit_depth,
             channels, bitrate_kbps, duration_seconds::float8 AS duration_seconds, file_size_bytes,
             checksum, is_lossless, available, validation_state, source_upload_id
      FROM audio_assets
      WHERE checksum = $1 AND available = TRUE
      LIMIT 1
    `, [checksum]);
    return result.rows[0] ?? null;
  }

  async latestArtworkUrl(entityType: 'album' | 'artist', entityId: string): Promise<string | null> {
    const result = await query<{ public_url: string | null }>(this.db, `
      SELECT public_url
      FROM artwork_assets
      WHERE entity_type = $1 AND entity_id = $2 AND available = TRUE AND status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 1
    `, [entityType, entityId]);
    return result.rows[0]?.public_url ?? null;
  }
}

export function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return toIso(value);
}

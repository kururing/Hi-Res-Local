import { normalizeCatalogName } from '../catalog/normalize.js';
import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';
import { isUnknownAlbumTitle, isUnknownArtistName } from './importMetadata.js';
import { UNKNOWN_ALBUM_PLACEHOLDER, UNKNOWN_ARTIST_PLACEHOLDER } from './placeholders.js';

export interface MatchCandidate {
  id: string;
  name: string;
}

export interface AlbumMatchCandidate {
  id: string;
  title: string;
  artist_name: string | null;
  primary_artist_id: string | null;
}

export interface TrackMatchCandidate {
  id: string;
  title: string;
  album_id: string | null;
}

export type MatchStatus = 'none' | 'exact' | 'ambiguous';

export interface FieldMatch<T> {
  status: MatchStatus;
  candidates: T[];
}

export interface ImportMatchResult {
  artist: FieldMatch<MatchCandidate>;
  album: FieldMatch<AlbumMatchCandidate>;
  track?: FieldMatch<TrackMatchCandidate>;
}

function first<T>(rows: T[]): FieldMatch<T> {
  if (rows.length === 0) return { status: 'none', candidates: [] };
  return { status: 'exact', candidates: [rows[0]!] };
}

export async function matchArtist(db: Queryable, input: {
  musicbrainzArtistId: string | null;
  name: string | null;
}): Promise<FieldMatch<MatchCandidate>> {
  if (input.musicbrainzArtistId) {
    const byMb = await query<MatchCandidate>(db, `
      SELECT id, name FROM artists
      WHERE musicbrainz_artist_id = $1
      ORDER BY created_at, id
      LIMIT 1
    `, [input.musicbrainzArtistId]);
    if (byMb.rows[0]) return first(byMb.rows);
  }
  if (isUnknownArtistName(input.name)) {
    const unknown = await query<MatchCandidate>(db, `
      SELECT id, name FROM artists
      WHERE placeholder_kind = $1
      ORDER BY created_at, id
      LIMIT 1
    `, [UNKNOWN_ARTIST_PLACEHOLDER]);
    if (unknown.rows[0]) return first(unknown.rows);
  }
  return matchArtistByName(db, input.name);
}

export async function matchArtistByName(db: Queryable, name: string | null): Promise<FieldMatch<MatchCandidate>> {
  const normalized = name ? normalizeCatalogName(name) : '';
  if (!normalized) return { status: 'none', candidates: [] };
  const result = await query<MatchCandidate>(db, `
    SELECT id, name
    FROM artists
    WHERE lower(btrim(regexp_replace(normalize(name, NFC), '\\s+', ' ', 'g'))) = $1
    ORDER BY created_at, id
    LIMIT 1
  `, [normalized]);
  const candidates = result.rows.filter((row) => normalizeCatalogName(row.name) === normalized);
  return first(candidates);
}

export async function matchAlbum(db: Queryable, input: {
  musicbrainzAlbumId: string | null;
  upc: string | null;
  title: string | null;
  artistName: string | null;
  artistId: string | null;
  year: number | null;
}): Promise<FieldMatch<AlbumMatchCandidate>> {
  if (input.musicbrainzAlbumId) {
    const byMb = await query<AlbumMatchCandidate>(db, albumSelect('al.musicbrainz_album_id = $1'), [input.musicbrainzAlbumId]);
    if (byMb.rows[0]) return first(byMb.rows);
  }
  if (input.upc) {
    const byUpc = await query<AlbumMatchCandidate>(db, albumSelect('al.upc = $1'), [input.upc]);
    if (byUpc.rows[0]) return first(byUpc.rows);
  }
  if (isUnknownAlbumTitle(input.title)) {
    const unknown = await query<AlbumMatchCandidate>(db, albumSelect('al.placeholder_kind = $1'), [UNKNOWN_ALBUM_PLACEHOLDER]);
    if (unknown.rows[0]) return first(unknown.rows);
  }
  return matchAlbumByTitleAndArtist(db, input.title, input.artistName, input.artistId, input.year);
}

function albumSelect(where: string): string {
  return `
    SELECT al.id, al.title, ar.name AS artist_name, al.primary_artist_id
    FROM albums al
    LEFT JOIN artists ar ON ar.id = al.primary_artist_id
    WHERE ${where}
    ORDER BY al.created_at, al.id
    LIMIT 1
  `;
}

export async function matchAlbumByTitleAndArtist(
  db: Queryable,
  title: string | null,
  artistName: string | null,
  artistId: string | null,
  year?: number | null,
): Promise<FieldMatch<AlbumMatchCandidate>> {
  const albumNorm = title ? normalizeCatalogName(title) : '';
  if (!albumNorm) return { status: 'none', candidates: [] };
  const artistNorm = artistName ? normalizeCatalogName(artistName) : '';

  const result = await query<AlbumMatchCandidate>(db, `
    SELECT al.id, al.title, ar.name AS artist_name, al.primary_artist_id, al.year
    FROM albums al
    LEFT JOIN artists ar ON ar.id = al.primary_artist_id
    WHERE lower(btrim(regexp_replace(normalize(al.title, NFC), '\\s+', ' ', 'g'))) = $1
    ORDER BY al.created_at, al.id
    LIMIT 16
  `, [albumNorm]);

  const byTitle = result.rows.filter((row) => normalizeCatalogName(row.title) === albumNorm);
  const narrowed = byTitle.filter((row) => {
    if (artistId && row.primary_artist_id === artistId) return true;
    if (artistNorm && row.artist_name && normalizeCatalogName(row.artist_name) === artistNorm) return true;
    if (!artistNorm && !artistId) return true;
    return false;
  });
  const withYear = (artistNorm || artistId ? narrowed : byTitle).filter((row) => {
    if (year == null) return true;
    const albumYear = (row as AlbumMatchCandidate & { year?: number | null }).year;
    return albumYear == null || albumYear === year;
  });
  const exactYear = withYear.filter((row) => {
    const albumYear = (row as AlbumMatchCandidate & { year?: number | null }).year;
    return year == null || albumYear === year;
  });
  return first(exactYear.length ? exactYear : withYear);
}

export async function matchTrack(db: Queryable, input: {
  isrc: string | null;
  musicbrainzTrackId: string | null;
  artistId: string | null;
  albumId: string | null;
  disc: number | null;
  track: number | null;
  title: string | null;
  checksum: string | null;
}): Promise<FieldMatch<TrackMatchCandidate>> {
  if (input.isrc) {
    const byIsrc = await query<TrackMatchCandidate>(db, `
      SELECT id, title, album_id FROM tracks
      WHERE isrc = $1 AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
    `, [input.isrc]);
    if (byIsrc.rows[0]) return first(byIsrc.rows);
  }
  if (input.musicbrainzTrackId) {
    const byMb = await query<TrackMatchCandidate>(db, `
      SELECT id, title, album_id FROM tracks
      WHERE musicbrainz_track_id = $1 AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
    `, [input.musicbrainzTrackId]);
    if (byMb.rows[0]) return first(byMb.rows);
  }
  const titleNorm = input.title ? normalizeCatalogName(input.title) : '';
  if (titleNorm && input.artistId && input.albumId) {
    const byFingerprint = await query<TrackMatchCandidate>(db, `
      SELECT t.id, t.title, t.album_id
      FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.id AND ta.position = 0
      WHERE t.deleted_at IS NULL
        AND t.album_id = $1
        AND ta.artist_id = $2
        AND t.disc_number IS NOT DISTINCT FROM $3
        AND t.track_number IS NOT DISTINCT FROM $4
        AND lower(btrim(regexp_replace(normalize(t.title, NFC), '\\s+', ' ', 'g'))) = $5
      ORDER BY t.created_at, t.id
      LIMIT 1
    `, [input.albumId, input.artistId, input.disc, input.track, titleNorm]);
    if (byFingerprint.rows[0]) return first(byFingerprint.rows);
  }
  if (input.checksum) {
    const byChecksum = await query<TrackMatchCandidate>(db, `
      SELECT t.id, t.title, t.album_id
      FROM audio_assets aa
      JOIN tracks t ON t.id = aa.track_id
      WHERE aa.checksum = $1 AND aa.available = TRUE AND t.deleted_at IS NULL
      ORDER BY t.created_at, t.id
      LIMIT 1
    `, [input.checksum]);
    if (byChecksum.rows[0]) return first(byChecksum.rows);
  }
  return { status: 'none', candidates: [] };
}

export async function buildImportMatch(
  db: Queryable,
  input: {
    artist: string | null;
    albumArtist: string | null;
    album: string | null;
    year?: number | null;
    musicbrainzArtistId?: string | null;
    musicbrainzAlbumId?: string | null;
    upc?: string | null;
    selectedArtistId?: string | null;
  },
): Promise<ImportMatchResult> {
  const artistName = input.albumArtist || input.artist;
  const artist = input.selectedArtistId
    ? await hydrateSelectedArtist(db, input.selectedArtistId)
    : await matchArtist(db, {
      musicbrainzArtistId: input.musicbrainzArtistId ?? null,
      name: artistName,
    });
  const artistId = input.selectedArtistId ?? (artist.status === 'exact' ? artist.candidates[0]?.id ?? null : null);
  const album = await matchAlbum(db, {
    musicbrainzAlbumId: input.musicbrainzAlbumId ?? null,
    upc: input.upc ?? null,
    title: input.album,
    artistName,
    artistId,
    year: input.year ?? null,
  });
  return { artist, album };
}

async function hydrateSelectedArtist(
  db: Queryable,
  artistId: string,
): Promise<FieldMatch<MatchCandidate>> {
  const result = await query<MatchCandidate>(db, 'SELECT id, name FROM artists WHERE id = $1', [artistId]);
  const row = result.rows[0];
  if (!row) return { status: 'none', candidates: [] };
  return { status: 'exact', candidates: [row] };
}

export function matchNeedsReview(_match: ImportMatchResult, _selectedArtistId: string | null, _selectedAlbumId: string | null): boolean {
  return false;
}

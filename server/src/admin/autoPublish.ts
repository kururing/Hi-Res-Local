import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types.js';
import { toNumber } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { LyricsRepository } from '../lyrics/repository.js';
import { audioMimeType } from '../streaming/mime.js';
import { classifyAudio } from '../ingestion/classification.js';
import { writeAdminAudit } from './audit.js';
import { AdminCatalogRepository, type AdminAlbumRow, type AdminArtistRow } from './catalogRepository.js';
import {
  importIsReady,
  isUnknownAlbumTitle,
  isUnknownArtistName,
  type ImportDetectedMetadata,
} from './importMetadata.js';
import { AudioImportRepository, type AudioImportRow } from './importRepository.js';
import { matchAlbum, matchArtist, matchTrack } from './matching.js';
import {
  UNKNOWN_ALBUM_PLACEHOLDER,
  UNKNOWN_ALBUM_TITLE,
  UNKNOWN_ARTIST_NAME,
  UNKNOWN_ARTIST_PLACEHOLDER,
} from './placeholders.js';
import { normalizeIsrc, normalizeMusicBrainzId, normalizeUpc } from '../ingestion/tags.js';
import { optionalGenre, sortNameFrom, TITLE_MAX, TRACK_NUMBER_MAX, YEAR_MAX, YEAR_MIN } from './validation.js';

export interface AutoPublishInput {
  row: AudioImportRow;
  detected: ImportDetectedMetadata;
  adminId: string;
  requestId: string;
  checksum: string;
  lyrics?: {
    kind: 'synced' | 'plain';
    synced_lrc: string | null;
    plain_text: string;
    lines: Array<{ timestamp_seconds: number; text: string }>;
    offset: number | null;
  } | null;
  artworkVariants?: unknown;
  artworkBucket?: string | null;
  artworkObjectKey?: string | null;
}

export interface AutoPublishResult {
  status: 'published' | 'duplicate';
  trackId: string;
  albumId: string | null;
  artistId: string | null;
  created: { artist: boolean; album: boolean; track: boolean };
}

export async function autoPublishImport(
  db: Queryable,
  input: AutoPublishInput,
): Promise<AutoPublishResult> {
  const imports = new AudioImportRepository(db);
  const catalog = new AdminCatalogRepository(db);
  const row = input.row;
  const detected = input.detected;

  if ((row.status === 'published' || row.status === 'duplicate') && row.committed_track_id) {
    return {
      status: row.status,
      trackId: row.committed_track_id,
      albumId: row.committed_album_id,
      artistId: row.committed_artist_id,
      created: { artist: false, album: false, track: false },
    };
  }

  if (!importIsReady({
    ...detected,
    selected_artist_id: null,
    selected_album_id: null,
    rights_holder: null,
    license_source_ref: null,
    territory_scope: null,
    rights_attested: false,
  })) {
    throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Import is missing title after fallback.');
  }

  const existingAsset = await catalog.findAvailableAssetByChecksum(input.checksum);
  if (existingAsset) {
    const track = await catalog.getTrack(existingAsset.track_id);
    if (!track || track.deleted_at) {
      throw new AppError(409, ErrorCodes.IMPORT_DUPLICATE_CHECKSUM, 'This audio file is already in the catalog.');
    }
    if (track.publication_state !== 'published') {
      await publishWithoutRights(catalog, track.id);
    }
    await imports.markOutcome({
      id: row.id,
      status: 'duplicate',
      trackId: track.id,
      albumId: track.album_id,
      artistId: null,
    });
    await writeAdminAudit(db, {
      adminUserId: input.adminId,
      action: 'import.duplicate',
      entityType: 'import',
      entityId: row.id,
      requestId: input.requestId,
      metadata: {
        track_id: track.id,
        checksum: input.checksum,
        outcome: 'duplicate',
      },
    });
    return {
      status: 'duplicate',
      trackId: track.id,
      albumId: track.album_id,
      artistId: null,
      created: { artist: false, album: false, track: false },
    };
  }

  await imports.setStatus(row.id, 'publishing');

  const artistName = detected.artist?.trim() || UNKNOWN_ARTIST_NAME;
  const albumTitle = detected.album?.trim() || UNKNOWN_ALBUM_TITLE;
  const title = clamp((detected.title ?? '').trim(), TITLE_MAX);

  let createdArtist = false;
  let createdAlbum = false;
  let createdTrack = false;

  const artist = await resolveArtist(catalog, db, {
    name: artistName,
    musicbrainzArtistId: sanitizeMbid(detected.musicbrainz_artist_id),
    adminId: input.adminId,
    requestId: input.requestId,
    onCreate: () => { createdArtist = true; },
  });

  const album = await resolveAlbum(catalog, db, {
    title: albumTitle,
    artist,
    year: detected.year,
    genre: detected.genre,
    musicbrainzAlbumId: sanitizeMbid(detected.musicbrainz_album_id),
    upc: sanitizeUpc(detected.upc),
    adminId: input.adminId,
    requestId: input.requestId,
    onCreate: () => { createdAlbum = true; },
  });

  const trackMatch = await matchTrack(db, {
    isrc: sanitizeIsrc(detected.isrc),
    musicbrainzTrackId: sanitizeMbid(detected.musicbrainz_track_id),
    artistId: artist.id,
    albumId: album.id,
    disc: detected.disc,
    track: detected.track,
    title,
    checksum: input.checksum,
  });

  let trackId: string;
  if (trackMatch.status === 'exact' && trackMatch.candidates[0]) {
    trackId = trackMatch.candidates[0].id;
  } else {
    const duration = detected.duration_seconds && detected.duration_seconds > 0
      ? detected.duration_seconds
      : 0.001;
    const track = await catalog.insertTrack({
      id: randomUUID(),
      title,
      albumId: album.id,
      trackNumber: inRange(detected.track, 1, TRACK_NUMBER_MAX),
      discNumber: inRange(detected.disc, 1, 99),
      genre: safeGenre(detected.genre),
      durationSeconds: duration,
      isrc: sanitizeIsrc(detected.isrc),
      musicbrainzTrackId: sanitizeMbid(detected.musicbrainz_track_id),
    });
    await catalog.replaceTrackArtists(track.id, [artist.id]);
    createdTrack = true;
    trackId = track.id;
  }

  await insertAsset(db, row, trackId, detected);
  if (detected.duration_seconds) {
    await catalog.updateTrack(trackId, { durationSeconds: detected.duration_seconds });
  }
  if (detected.artwork_public_url && !album.cover_art_url) {
    await db.query('SAVEPOINT import_artwork');
    try {
      await catalog.updateAlbum(album.id, { coverArtUrl: detected.artwork_public_url });
      await insertArtworkRow(db, {
        albumId: album.id,
        uploadId: row.upload_id,
        publicUrl: detected.artwork_public_url,
        bucket: input.artworkBucket ?? null,
        objectKey: input.artworkObjectKey ?? detected.artwork_public_url,
        variants: input.artworkVariants ?? [],
      });
      await db.query('RELEASE SAVEPOINT import_artwork');
    } catch {
      await db.query('ROLLBACK TO SAVEPOINT import_artwork');
    }
  }

  if (input.lyrics) {
    await db.query('SAVEPOINT import_lyrics');
    try {
      await storeEmbeddedLyrics(db, trackId, title, artist.name, album.title, input.lyrics);
      await db.query('RELEASE SAVEPOINT import_lyrics');
    } catch {
      await db.query('ROLLBACK TO SAVEPOINT import_lyrics');
    }
  }

  await publishWithoutRights(catalog, trackId);
  await imports.markOutcome({
    id: row.id,
    status: 'published',
    trackId,
    albumId: album.id,
    artistId: artist.id,
  });
  await writeAdminAudit(db, {
    adminUserId: input.adminId,
    action: 'import.publish',
    entityType: 'import',
    entityId: row.id,
    requestId: input.requestId,
    metadata: {
      track_id: trackId,
      album_id: album.id,
      artist_id: artist.id,
      checksum: input.checksum,
      outcome: 'published',
      created: { artist: createdArtist, album: createdAlbum, track: createdTrack },
    },
  });

  return {
    status: 'published',
    trackId,
    albumId: album.id,
    artistId: artist.id,
    created: { artist: createdArtist, album: createdAlbum, track: createdTrack },
  };
}

async function resolveArtist(
  catalog: AdminCatalogRepository,
  db: Queryable,
  input: {
    name: string;
    musicbrainzArtistId: string | null;
    adminId: string;
    requestId: string;
    onCreate: () => void;
  },
): Promise<AdminArtistRow> {
  if (isUnknownArtistName(input.name)) {
    return catalog.ensurePlaceholderArtist(UNKNOWN_ARTIST_PLACEHOLDER, UNKNOWN_ARTIST_NAME, sortNameFrom(UNKNOWN_ARTIST_NAME));
  }
  const match = await matchArtist(db, {
    musicbrainzArtistId: input.musicbrainzArtistId,
    name: input.name,
  });
  if (match.status === 'exact' && match.candidates[0]) {
    const existing = await catalog.getArtist(match.candidates[0].id);
    if (existing) return existing;
  }
  input.onCreate();
  const created = await catalog.insertArtist(
    randomUUID(),
    clamp(input.name, 200),
    sortNameFrom(input.name),
    { musicbrainzArtistId: input.musicbrainzArtistId },
  );
  await writeAdminAudit(db, {
    adminUserId: input.adminId,
    action: 'artist.create',
    entityType: 'artist',
    entityId: created.id,
    requestId: input.requestId,
    metadata: { name: input.name, source: 'import' },
  });
  return created;
}

async function resolveAlbum(
  catalog: AdminCatalogRepository,
  db: Queryable,
  input: {
    title: string;
    artist: AdminArtistRow;
    year: number | null;
    genre: string | null;
    musicbrainzAlbumId: string | null;
    upc: string | null;
    adminId: string;
    requestId: string;
    onCreate: () => void;
  },
): Promise<AdminAlbumRow> {
  if (isUnknownAlbumTitle(input.title)) {
    return catalog.ensurePlaceholderAlbum(UNKNOWN_ALBUM_PLACEHOLDER, UNKNOWN_ALBUM_TITLE, input.artist.id);
  }
  const match = await matchAlbum(db, {
    musicbrainzAlbumId: input.musicbrainzAlbumId,
    upc: input.upc,
    title: input.title,
    artistName: input.artist.name,
    artistId: input.artist.id,
    year: input.year,
  });
  if (match.status === 'exact' && match.candidates[0]) {
    const existing = await catalog.getAlbum(match.candidates[0].id);
    if (existing) return existing;
  }
  input.onCreate();
  const year = input.year && input.year >= YEAR_MIN && input.year <= YEAR_MAX ? input.year : null;
  const created = await catalog.insertAlbum({
    id: randomUUID(),
    title: clamp(input.title, TITLE_MAX),
    primaryArtistId: input.artist.id,
    year,
    genre: safeGenre(input.genre),
    musicbrainzAlbumId: input.musicbrainzAlbumId,
    upc: input.upc,
  });
  await writeAdminAudit(db, {
    adminUserId: input.adminId,
    action: 'album.create',
    entityType: 'album',
    entityId: created.id,
    requestId: input.requestId,
    metadata: { title: input.title, source: 'import' },
  });
  return created;
}

async function insertAsset(
  trx: Queryable,
  row: AudioImportRow,
  trackId: string,
  detected: ImportDetectedMetadata,
): Promise<void> {
  if (!row.object_key?.trim()) {
    throw new AppError(409, ErrorCodes.IMPORT_NOT_READY, 'Import is missing a storage object.');
  }
  await trx.query(`
    INSERT INTO audio_assets (
      id, track_id, storage_key, container, codec, mime_type, sample_rate_hz, bit_depth,
      channels, bitrate_kbps, duration_seconds, file_size_bytes, checksum, is_lossless,
      hi_res, is_dsd, dsd_rate,
      replaygain_track_gain, replaygain_track_peak, replaygain_album_gain, replaygain_album_peak,
      available, validation_state, source_upload_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, TRUE, 'ready', $22
    )
    ON CONFLICT (storage_key) DO UPDATE SET
      available = TRUE,
      validation_state = 'ready',
      hi_res = EXCLUDED.hi_res,
      is_dsd = EXCLUDED.is_dsd,
      dsd_rate = EXCLUDED.dsd_rate,
      replaygain_track_gain = EXCLUDED.replaygain_track_gain,
      replaygain_track_peak = EXCLUDED.replaygain_track_peak,
      replaygain_album_gain = EXCLUDED.replaygain_album_gain,
      replaygain_album_peak = EXCLUDED.replaygain_album_peak,
      updated_at = timezone('utc', now())
  `, [
    randomUUID(),
    trackId,
    row.object_key,
    detected.container ?? 'flac',
    detected.codec ?? 'flac',
    audioMimeType(detected.codec ?? 'flac', detected.container ?? 'flac') ?? row.expected_mime,
    detected.sample_rate_hz && detected.sample_rate_hz > 0 ? detected.sample_rate_hz : 44_100,
    detected.bit_depth,
    detected.channels && detected.channels > 0 ? detected.channels : 2,
    detected.bitrate_kbps,
    detected.duration_seconds && detected.duration_seconds > 0 ? detected.duration_seconds : 0.001,
    toNumber(row.expected_size_bytes),
    row.expected_checksum_sha256,
    detected.lossless,
    detected.hi_res,
    detected.dsd,
    detected.dsd ? (detected.sample_rate_hz && detected.sample_rate_hz > 0
      ? classifyAudio({
        codec: detected.codec ?? 'dsd',
        container: detected.container ?? 'dsf',
        sampleRateHz: detected.sample_rate_hz,
        bitDepth: detected.bit_depth,
        isLossless: detected.lossless,
      }).dsdRate
      : null) : null,
    detected.replaygain_track_gain,
    detected.replaygain_track_peak,
    detected.replaygain_album_gain,
    detected.replaygain_album_peak,
    row.upload_id,
  ]);
}

async function insertArtworkRow(db: Queryable, input: {
  albumId: string;
  uploadId: string | null;
  publicUrl: string;
  bucket: string | null;
  objectKey: string;
  variants: unknown;
}): Promise<void> {
  const key = input.objectKey.slice(0, 1024);
  await db.query(`
    INSERT INTO artwork_assets (
      id, entity_type, entity_id, source_upload_id, status, original_object_key, bucket,
      mime_type, width, height, checksum_sha256, variants_json, public_url, available
    ) VALUES (
      $1,'album',$2,$3,'ready',$4,$5,'image/webp',NULL,NULL,NULL,$6::jsonb,$7, TRUE
    )
  `, [
    randomUUID(),
    input.albumId,
    input.uploadId,
    key,
    input.bucket ?? 'artwork',
    JSON.stringify(input.variants ?? []),
    input.publicUrl,
  ]);
}

async function storeEmbeddedLyrics(
  db: Queryable,
  trackId: string,
  title: string,
  artist: string,
  album: string,
  lyrics: NonNullable<AutoPublishInput['lyrics']>,
): Promise<void> {
  const repo = new LyricsRepository(db);
  await repo.upsert({
    trackId,
    status: 'found',
    provider: 'embedded',
    syncedLrc: lyrics.synced_lrc,
    plainText: lyrics.plain_text,
    lines: lyrics.kind === 'synced' ? lyrics.lines : null,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    attribution: null,
    title,
    artist,
    album,
    isSynced: lyrics.kind === 'synced',
    instrumental: false,
    offset: lyrics.offset,
  });
}

async function publishWithoutRights(catalog: AdminCatalogRepository, trackId: string): Promise<void> {
  const track = await catalog.getTrack(trackId);
  if (!track) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
  const artists = await catalog.listTrackArtists(trackId);
  const assets = await catalog.listAssets(trackId);
  const hasReadyAsset = await catalog.hasReadyAsset(trackId);
  const blockingJob = await catalog.hasBlockingJob(trackId);
  const ready = hasReadyAsset || assets.some((asset) => asset.available && asset.validation_state === 'ready');
  if (!track.title.trim()) throw new AppError(409, ErrorCodes.PUBLISH_NOT_READY, 'Track cannot be published: title_required.');
  if (artists.length === 0) throw new AppError(409, ErrorCodes.PUBLISH_NOT_READY, 'Track cannot be published: artist_required.');
  if (!track.album_id) throw new AppError(409, ErrorCodes.PUBLISH_NOT_READY, 'Track cannot be published: album_required.');
  if (!ready) throw new AppError(409, ErrorCodes.PUBLISH_NOT_READY, 'Track cannot be published: audio_asset_not_ready.');
  if (blockingJob) throw new AppError(409, ErrorCodes.PUBLISH_NOT_READY, 'Track cannot be published: ingestion_not_ready.');
  if (track.deleted_at) throw new AppError(409, ErrorCodes.PUBLISH_NOT_READY, 'Track cannot be published: track_deleted.');
  await catalog.setPublication(trackId, true);
}

function safeGenre(value: string | null): string | null {
  if (!value) return null;
  try {
    return optionalGenre(value);
  } catch {
    return null;
  }
}

function clamp(value: string, max: number): string {
  return value.slice(0, max);
}

function inRange(value: number | null, min: number, max: number): number | null {
  if (value == null || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function sanitizeMbid(value: string | null | undefined): string | null {
  return normalizeMusicBrainzId(value ?? null);
}

function sanitizeUpc(value: string | null | undefined): string | null {
  return normalizeUpc(value ?? null);
}

function sanitizeIsrc(value: string | null | undefined): string | null {
  return normalizeIsrc(value ?? null);
}

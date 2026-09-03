import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env.js';
import { withTransaction } from '../db/types.js';
import { toIso, toNumber } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { writeAdminAudit } from './audit.js';
import {
  AdminCatalogRepository,
  isoOrNull,
  type AdminAlbumRow,
  type AdminArtistRow,
  type AdminAssetRow,
  type AdminRightsRow,
  type AdminTrackRow,
} from './catalogRepository.js';
import {
  optionalGenre,
  optionalInteger,
  optionalTrimmed,
  rejectClientAvailability,
  requiredName,
  sortNameFrom,
  TITLE_MAX,
  TRACK_NUMBER_MAX,
  YEAR_MAX,
  YEAR_MIN,
} from './validation.js';
import { isUnknownAlbumTitle, isUnknownArtistName } from './importMetadata.js';
import {
  createITunesRemoteArtworkLookup,
  isArtistPortraitUrl,
  isItunesAlbumArtworkUrl,
  type RemoteArtworkLookup,
} from '../ingestion/remoteArtwork.js';

export interface AdminArtistView {
  id: string;
  name: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtworkLookupView {
  id: string;
  entity_type: 'artist' | 'album';
  url: string | null;
  found: boolean;
}

export interface ArtworkLookupBatchView {
  looked_up: number;
  filled: number;
  skipped: number;
  artists: ArtworkLookupView[];
  albums: ArtworkLookupView[];
}

export interface AdminAlbumView {
  id: string;
  title: string;
  primary_artist_id: string | null;
  artist_name: string | null;
  year: number | null;
  genre: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAssetView {
  id: string;
  container: string;
  codec: string;
  mime_type: string | null;
  sample_rate_hz: number;
  bit_depth: number | null;
  channels: number;
  bitrate_kbps: number | null;
  duration_seconds: number;
  file_size_bytes: number;
  checksum_sha256: string;
  lossless: boolean;
  available: boolean;
  validation_state: string;
}

export interface AdminRightsView {
  rights_holder: string | null;
  license_source_ref: string | null;
  territory_scope: string | null;
  attested: boolean;
  attested_by: string | null;
  attested_at: string | null;
}

export interface AdminTrackView {
  id: string;
  title: string;
  album_id: string | null;
  album_title: string | null;
  artists: Array<{ id: string; name: string }>;
  track_number: number | null;
  disc_number: number | null;
  duration_seconds: number;
  genre: string | null;
  publication_state: 'draft' | 'published';
  available: boolean;
  deleted: boolean;
  assets: AdminAssetView[];
  rights: AdminRightsView;
  ingestion: {
    latest_upload_id: string | null;
    latest_upload_status: string | null;
    latest_job_id: string | null;
    latest_job_status: string | null;
    latest_job_error: string | null;
  };
  publish_blockers: string[];
  created_at: string;
  updated_at: string;
}

function artistView(row: AdminArtistRow): AdminArtistView {
  return {
    id: row.id,
    name: row.name,
    image_url: row.image_url,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function albumView(row: AdminAlbumRow): AdminAlbumView {
  return {
    id: row.id,
    title: row.title,
    primary_artist_id: row.primary_artist_id,
    artist_name: row.artist_name,
    year: row.year,
    genre: row.genre,
    cover_url: row.cover_art_url,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function assetView(row: AdminAssetRow): AdminAssetView {
  return {
    id: row.id,
    container: row.container,
    codec: row.codec,
    mime_type: row.mime_type,
    sample_rate_hz: toNumber(row.sample_rate_hz),
    bit_depth: row.bit_depth == null ? null : toNumber(row.bit_depth),
    channels: toNumber(row.channels),
    bitrate_kbps: row.bitrate_kbps == null ? null : toNumber(row.bitrate_kbps),
    duration_seconds: toNumber(row.duration_seconds),
    file_size_bytes: toNumber(row.file_size_bytes),
    checksum_sha256: row.checksum,
    lossless: row.is_lossless,
    available: row.available,
    validation_state: row.validation_state,
  };
}

function rightsView(row: AdminRightsRow | null): AdminRightsView {
  if (!row) {
    return {
      rights_holder: null,
      license_source_ref: null,
      territory_scope: null,
      attested: false,
      attested_by: null,
      attested_at: null,
    };
  }
  return {
    rights_holder: row.rights_holder,
    license_source_ref: row.license_source_ref,
    territory_scope: row.territory_scope,
    attested: row.attested,
    attested_by: row.attested_by,
    attested_at: isoOrNull(row.attested_at),
  };
}

export function computePublishBlockers(input: {
  track: AdminTrackRow;
  artists: Array<{ id: string }>;
  albumId: string | null;
  hasReadyAsset: boolean;
  rights: AdminRightsRow | null;
  blockingJob: boolean;
  artworkRequired: boolean;
  hasArtwork: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!input.track.title.trim()) blockers.push('title_required');
  if (input.artists.length === 0) blockers.push('artist_required');
  if (!input.albumId) blockers.push('album_required');
  if (!input.hasReadyAsset) blockers.push('audio_asset_not_ready');
  if (!input.rights?.attested || !input.rights.rights_holder || !input.rights.license_source_ref) {
    blockers.push('rights_attestation_required');
  }
  if (input.blockingJob) blockers.push('ingestion_not_ready');
  if (input.artworkRequired && !input.hasArtwork) blockers.push('artwork_required');
  if (input.track.deleted_at) blockers.push('track_deleted');
  return blockers;
}

export class AdminCatalogService {
  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly remoteArtwork: RemoteArtworkLookup = createITunesRemoteArtworkLookup(),
  ) {}

  async listArtists(q?: string): Promise<AdminArtistView[]> {
    return (await new AdminCatalogRepository(this.pool).listArtists(q)).map(artistView);
  }

  async createArtist(body: Record<string, unknown>, adminId: string, requestId: string): Promise<AdminArtistView> {
    rejectClientAvailability(body);
    const name = requiredName(body.name, 'name');
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const artist = await repo.insertArtist(randomUUID(), name, sortNameFrom(name));
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'artist.create',
        entityType: 'artist',
        entityId: artist.id,
        requestId,
        metadata: { name },
      });
      return artistView(artist);
    });
  }

  async updateArtist(id: string, body: Record<string, unknown>, adminId: string, requestId: string): Promise<AdminArtistView> {
    rejectClientAvailability(body);
    const name = requiredName(body.name, 'name');
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const artist = await repo.updateArtist(id, { name, sortName: sortNameFrom(name) });
      if (!artist) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Artist not found.');
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'artist.update',
        entityType: 'artist',
        entityId: id,
        requestId,
        metadata: { name },
      });
      return artistView(artist);
    });
  }

  async listAlbums(q?: string): Promise<AdminAlbumView[]> {
    return (await new AdminCatalogRepository(this.pool).listAlbums(q)).map(albumView);
  }

  async lookupArtistArtwork(
    id: string,
    adminId: string,
    requestId: string,
    force = false,
  ): Promise<ArtworkLookupView> {
    const repo = new AdminCatalogRepository(this.pool);
    const artist = await repo.getArtist(id);
    if (!artist) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Artist not found.');
    if (artist.image_url && !force) {
      if (
        !isItunesAlbumArtworkUrl(artist.image_url)
        && !await repo.artistImageMatchesOwnAlbumCover(id, artist.image_url)
      ) {
        return { id, entity_type: 'artist', url: artist.image_url, found: true };
      }
    }
    if (isUnknownArtistName(artist.name)) {
      return { id, entity_type: 'artist', url: artist.image_url, found: false };
    }
    const albumHint = await repo.findRepresentativeAlbumTitle(id);
    const url = await this.remoteArtwork.lookupArtistPortrait(artist.name, albumHint ?? undefined);
    if (!url && artist.image_url) {
      if (
        isItunesAlbumArtworkUrl(artist.image_url)
        || await repo.artistImageMatchesOwnAlbumCover(id, artist.image_url)
      ) {
        await repo.updateArtist(id, { imageUrl: null });
        return this.persistArtistUrl(id, null, adminId, requestId);
      }
      return { id, entity_type: 'artist', url: artist.image_url, found: false };
    }
    return this.persistArtistUrl(id, url, adminId, requestId);
  }

  async lookupAlbumArtwork(
    id: string,
    adminId: string,
    requestId: string,
    force = false,
  ): Promise<ArtworkLookupView> {
    const repo = new AdminCatalogRepository(this.pool);
    const album = await repo.getAlbum(id);
    if (!album) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Album not found.');
    if (album.cover_art_url && !force) {
      return { id, entity_type: 'album', url: album.cover_art_url, found: true };
    }
    if (isUnknownAlbumTitle(album.title)) {
      return { id, entity_type: 'album', url: album.cover_art_url, found: false };
    }
    const url = await this.remoteArtwork.lookupAlbumCover(album.artist_name ?? '', album.title);
    if (!url && album.cover_art_url) {
      return { id, entity_type: 'album', url: album.cover_art_url, found: false };
    }
    return this.persistAlbumUrl(id, url, adminId, requestId);
  }

  async lookupMissingArtwork(adminId: string, requestId: string): Promise<ArtworkLookupBatchView> {
    const repo = new AdminCatalogRepository(this.pool);
    const artists = await repo.listArtistsMissingImage(50);
    const albums = await repo.listAlbumsMissingCover(50);
    const artistResults = await mapPool(artists, 3, item => this.lookupArtistArtwork(item.id, adminId, requestId));
    const albumResults = await mapPool(albums, 3, item => this.lookupAlbumArtwork(item.id, adminId, requestId));
    const results = [...artistResults, ...albumResults];
    return {
      looked_up: results.length,
      filled: results.filter(item => item.found && item.url).length,
      skipped: results.filter(item => !item.found).length,
      artists: artistResults,
      albums: albumResults,
    };
  }

  private async persistArtistUrl(
    id: string,
    url: string | null,
    adminId: string,
    requestId: string,
  ): Promise<ArtworkLookupView> {
    if (!url || !isArtistPortraitUrl(url)) {
      await writeAdminAudit(this.pool, {
        adminUserId: adminId,
        action: 'artwork.lookup',
        entityType: 'artist',
        entityId: id,
        requestId,
        metadata: { found: false },
      });
      return { id, entity_type: 'artist', url: null, found: false };
    }
    return withTransaction(this.pool, async (trx) => {
      const updated = await new AdminCatalogRepository(trx).updateArtist(id, { imageUrl: url });
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'artwork.lookup',
        entityType: 'artist',
        entityId: id,
        requestId,
        metadata: { found: true, source: 'itunes' },
      });
      return { id, entity_type: 'artist' as const, url: updated?.image_url ?? url, found: true };
    });
  }

  private async persistAlbumUrl(
    id: string,
    url: string | null,
    adminId: string,
    requestId: string,
  ): Promise<ArtworkLookupView> {
    if (!url) {
      await writeAdminAudit(this.pool, {
        adminUserId: adminId,
        action: 'artwork.lookup',
        entityType: 'album',
        entityId: id,
        requestId,
        metadata: { found: false },
      });
      return { id, entity_type: 'album', url: null, found: false };
    }
    return withTransaction(this.pool, async (trx) => {
      const updated = await new AdminCatalogRepository(trx).updateAlbum(id, { coverArtUrl: url });
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'artwork.lookup',
        entityType: 'album',
        entityId: id,
        requestId,
        metadata: { found: true, source: 'itunes' },
      });
      return { id, entity_type: 'album' as const, url: updated?.cover_art_url ?? url, found: true };
    });
  }

  async createAlbum(body: Record<string, unknown>, adminId: string, requestId: string): Promise<AdminAlbumView> {
    rejectClientAvailability(body);
    const title = requiredName(body.title, 'title', TITLE_MAX);
    const primaryArtistId = optionalTrimmed(body.primary_artist_id, 'primary_artist_id', 36);
    const year = optionalInteger(body.year, 'year', YEAR_MIN, YEAR_MAX);
    const genre = optionalGenre(body.genre);
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      if (primaryArtistId && !(await repo.getArtist(primaryArtistId))) {
        throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'primary_artist_id is not a known artist.');
      }
      const album = await repo.insertAlbum({
        id: randomUUID(),
        title,
        primaryArtistId,
        year,
        genre,
      });
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'album.create',
        entityType: 'album',
        entityId: album.id,
        requestId,
        metadata: { title, primary_artist_id: primaryArtistId, year, genre },
      });
      return albumView(album);
    });
  }

  async updateAlbum(id: string, body: Record<string, unknown>, adminId: string, requestId: string): Promise<AdminAlbumView> {
    rejectClientAvailability(body);
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const patch: Parameters<AdminCatalogRepository['updateAlbum']>[1] = {};
      if ('title' in body) patch.title = requiredName(body.title, 'title', TITLE_MAX);
      if ('primary_artist_id' in body) {
        const artistId = optionalTrimmed(body.primary_artist_id, 'primary_artist_id', 36);
        if (artistId && !(await repo.getArtist(artistId))) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'primary_artist_id is not a known artist.');
        }
        patch.primaryArtistId = artistId;
      }
      if ('year' in body) patch.year = optionalInteger(body.year, 'year', YEAR_MIN, YEAR_MAX);
      if ('genre' in body) patch.genre = optionalGenre(body.genre);
      const album = await repo.updateAlbum(id, patch);
      if (!album) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Album not found.');
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'album.update',
        entityType: 'album',
        entityId: id,
        requestId,
        metadata: patch,
      });
      return albumView(album);
    });
  }

  async listTracks(q?: string): Promise<AdminTrackView[]> {
    const repo = new AdminCatalogRepository(this.pool);
    const rows = await repo.listTracks(q);
    return Promise.all(rows.map((row) => this.hydrateTrack(repo, row)));
  }

  async getTrack(id: string): Promise<AdminTrackView> {
    const repo = new AdminCatalogRepository(this.pool);
    const row = await repo.getTrack(id);
    if (!row || row.deleted_at) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
    return this.hydrateTrack(repo, row);
  }

  async createTrack(body: Record<string, unknown>, adminId: string, requestId: string): Promise<AdminTrackView> {
    rejectClientAvailability(body);
    const title = requiredName(body.title, 'title', TITLE_MAX);
    const albumId = optionalTrimmed(body.album_id, 'album_id', 36);
    const artistIds = parseArtistIds(body.artist_ids);
    const trackNumber = optionalInteger(body.track_number, 'track_number', 1, TRACK_NUMBER_MAX);
    const discNumber = optionalInteger(body.disc_number, 'disc_number', 1, 99);
    const genre = optionalGenre(body.genre);
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      if (albumId && !(await repo.getAlbum(albumId))) {
        throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'album_id is not a known album.');
      }
      for (const artistId of artistIds) {
        if (!(await repo.getArtist(artistId))) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'artist_ids contains an unknown artist.');
        }
      }
      const track = await repo.insertTrack({
        id: randomUUID(),
        title,
        albumId,
        trackNumber,
        discNumber,
        genre,
      });
      if (artistIds.length) await repo.replaceTrackArtists(track.id, artistIds);
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'track.create',
        entityType: 'track',
        entityId: track.id,
        requestId,
        metadata: { title, album_id: albumId, artist_ids: artistIds },
      });
      return this.hydrateTrack(repo, (await repo.getTrack(track.id))!);
    });
  }

  async updateTrack(id: string, body: Record<string, unknown>, adminId: string, requestId: string): Promise<AdminTrackView> {
    rejectClientAvailability(body);
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const current = await repo.getTrack(id);
      if (!current || current.deleted_at) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
      const patch: Parameters<AdminCatalogRepository['updateTrack']>[1] = {};
      if ('title' in body) patch.title = requiredName(body.title, 'title', TITLE_MAX);
      if ('album_id' in body) {
        const albumId = optionalTrimmed(body.album_id, 'album_id', 36);
        if (albumId && !(await repo.getAlbum(albumId))) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'album_id is not a known album.');
        }
        patch.albumId = albumId;
      }
      if ('track_number' in body) patch.trackNumber = optionalInteger(body.track_number, 'track_number', 1, TRACK_NUMBER_MAX);
      if ('disc_number' in body) patch.discNumber = optionalInteger(body.disc_number, 'disc_number', 1, 99);
      if ('genre' in body) patch.genre = optionalGenre(body.genre);
      await repo.updateTrack(id, patch);
      if ('artist_ids' in body) {
        const artistIds = parseArtistIds(body.artist_ids);
        for (const artistId of artistIds) {
          if (!(await repo.getArtist(artistId))) {
            throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'artist_ids contains an unknown artist.');
          }
        }
        await repo.replaceTrackArtists(id, artistIds);
      }
      if ('rights_holder' in body || 'license_source_ref' in body || 'territory_scope' in body || 'rights_attested' in body) {
        if ('rights_attested' in body && body.rights_attested !== true && body.rights_attested !== false) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'rights_attested must be an explicit confirmation.');
        }
        const existingRights = await repo.getRights(id);
        const holder = 'rights_holder' in body
          ? requiredName(body.rights_holder, 'rights_holder')
          : existingRights?.rights_holder ?? '';
        const source = 'license_source_ref' in body
          ? requiredName(body.license_source_ref, 'license_source_ref', 500)
          : existingRights?.license_source_ref ?? '';
        const attested = body.rights_attested === true;
        if (!holder || !source) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Rights holder and license/source reference are required.');
        }
        await repo.upsertRights({
          trackId: id,
          rightsHolder: holder,
          licenseSourceRef: source,
          territoryScope: 'territory_scope' in body
            ? optionalTrimmed(body.territory_scope, 'territory_scope', 120)
            : existingRights?.territory_scope ?? null,
          attested,
          attestedBy: attested ? adminId : null,
        });
      }
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'track.update',
        entityType: 'track',
        entityId: id,
        requestId,
        metadata: { ...patch, rights_attested: body.rights_attested === true },
      });
      return this.hydrateTrack(repo, (await repo.getTrack(id))!);
    });
  }

  async deleteTrack(id: string, adminId: string, requestId: string): Promise<{ deleted: boolean; unpublished: boolean }> {
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const track = await repo.getTrack(id);
      if (!track || track.deleted_at) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
      const refs = await repo.trackReferenceCounts(id);
      const referenced = refs.history + refs.library + refs.playlists > 0;
      if (referenced) {
        await repo.softDeleteTrack(id);
        await writeAdminAudit(trx, {
          adminUserId: adminId,
          action: 'track.unpublish_delete',
          entityType: 'track',
          entityId: id,
          requestId,
          metadata: refs,
        });
        return { deleted: false, unpublished: true };
      }
      await repo.hardDeleteTrack(id);
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'track.delete',
        entityType: 'track',
        entityId: id,
        requestId,
        metadata: {},
      });
      return { deleted: true, unpublished: false };
    });
  }

  async publish(id: string, adminId: string, requestId: string): Promise<AdminTrackView> {
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const track = await repo.getTrack(id);
      if (!track || track.deleted_at) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
      const view = await this.hydrateTrack(repo, track);
      if (view.publish_blockers.length > 0) {
        throw new AppError(
          409,
          ErrorCodes.PUBLISH_NOT_READY,
          `Track cannot be published: ${view.publish_blockers.join(', ')}.`,
        );
      }
      await repo.setPublication(id, true);
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'track.publish',
        entityType: 'track',
        entityId: id,
        requestId,
        metadata: { publication_state: 'published' },
      });
      return this.hydrateTrack(repo, (await repo.getTrack(id))!);
    });
  }

  async unpublish(id: string, adminId: string, requestId: string): Promise<AdminTrackView> {
    return withTransaction(this.pool, async (trx) => {
      const repo = new AdminCatalogRepository(trx);
      const track = await repo.getTrack(id);
      if (!track || track.deleted_at) throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
      await repo.setPublication(id, false);
      await writeAdminAudit(trx, {
        adminUserId: adminId,
        action: 'track.unpublish',
        entityType: 'track',
        entityId: id,
        requestId,
        metadata: { publication_state: 'draft' },
      });
      return this.hydrateTrack(repo, (await repo.getTrack(id))!);
    });
  }

  private async hydrateTrack(repo: AdminCatalogRepository, row: AdminTrackRow): Promise<AdminTrackView> {
    const [artists, assets, rights, ingestion, hasReadyAsset, blockingJob] = await Promise.all([
      repo.listTrackArtists(row.id),
      repo.listAssets(row.id),
      repo.getRights(row.id),
      repo.ingestionSummary(row.id),
      repo.hasReadyAsset(row.id),
      repo.hasBlockingJob(row.id),
    ]);
    const hasArtwork = row.album_id
      ? Boolean(await repo.latestArtworkUrl('album', row.album_id))
      : false;
    return {
      id: row.id,
      title: row.title,
      album_id: row.album_id,
      album_title: row.album_title,
      artists,
      track_number: row.track_number,
      disc_number: row.disc_number,
      duration_seconds: toNumber(row.duration_seconds),
      genre: row.genre,
      publication_state: row.publication_state,
      available: row.available,
      deleted: Boolean(row.deleted_at),
      assets: assets.map(assetView),
      rights: rightsView(rights),
      ingestion,
      publish_blockers: computePublishBlockers({
        track: row,
        artists,
        albumId: row.album_id,
        hasReadyAsset,
        rights,
        blockingJob,
        artworkRequired: this.config.artworkRequiredForPublish,
        hasArtwork,
      }),
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }
}

function parseArtistIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'artist_ids must be an array of UUIDs.');
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]!);
    }
  });
  await Promise.all(workers);
  return results;
}

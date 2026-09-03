import type { AdminCatalogApi } from '../../platform/admin/contracts';
import type {
  AdminAlbum,
  AdminArtist,
  AdminCapabilities,
  AdminTrack,
  CreateAlbumInput,
  CreateArtistInput,
  CreateTrackInput,
  PresignedUpload,
  UpdateTrackInput,
  UploadInitInput,
  UploadStatus,
  AdminImport,
  AdminImportCreateResponse,
  UpdateImportInput,
  CommitImportInput,
  ArtworkLookupResult,
  ArtworkLookupBatchResult,
} from '../../platform/admin/types';

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function emptyRights(): AdminTrack['rights'] {
  return {
    rights_holder: null,
    license_source_ref: null,
    territory_scope: null,
    attested: false,
    attested_by: null,
    attested_at: null,
  };
}

export function emptyIngestion(): AdminTrack['ingestion'] {
  return {
    latest_upload_id: null,
    latest_upload_status: null,
    latest_job_id: null,
    latest_job_error: null,
    latest_job_status: null,
  };
}

export function sampleArtist(overrides: Partial<AdminArtist> = {}): AdminArtist {
  return {
    id: overrides.id ?? 'artist-1',
    name: overrides.name ?? 'Demo Artist',
    image_url: overrides.image_url ?? null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function sampleAlbum(overrides: Partial<AdminAlbum> = {}): AdminAlbum {
  return {
    id: overrides.id ?? 'album-1',
    title: overrides.title ?? 'Demo Album',
    primary_artist_id: 'artist-1',
    artist_name: 'Demo Artist',
    year: 2024,
    genre: 'Electronic',
    cover_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function sampleTrack(overrides: Partial<AdminTrack> = {}): AdminTrack {
  return {
    id: overrides.id ?? 'track-1',
    title: overrides.title ?? 'Demo Track',
    album_id: 'album-1',
    album_title: 'Demo Album',
    artists: [{ id: 'artist-1', name: 'Demo Artist' }],
    track_number: 1,
    disc_number: 1,
    duration_seconds: 0,
    genre: 'Electronic',
    publication_state: 'draft',
    available: false,
    deleted: false,
    assets: [],
    rights: emptyRights(),
    ingestion: emptyIngestion(),
    publish_blockers: ['audio_asset_not_ready', 'rights_attestation_required'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function sampleImport(overrides: Partial<AdminImport> = {}): AdminImport {
  const title = overrides.effective?.title ?? overrides.detected?.title ?? 'Night Drive';
  const artist = overrides.effective?.artist ?? 'Demo Artist';
  const album = overrides.effective?.album ?? 'Demo Album';
  const review = overrides.review_fields ?? [];
  return {
    id: overrides.id ?? 'import-1',
    status: overrides.status ?? 'ready',
    original_filename: overrides.original_filename ?? 'track.flac',
    expected_mime: 'audio/flac',
    expected_size_bytes: 2048,
    checksum_sha256: 'aa'.repeat(32),
    upload_id: 'upload-1',
    job_id: 'job-1',
    job_status: 'ready',
    detected: { title, artist, album, album_artist: artist, codec: 'flac', container: 'flac', sample_rate_hz: 44100, bit_depth: 16, file_size_bytes: 2048, review_fields: review },
    override: {},
    effective: { title, artist, album, album_artist: artist, codec: 'flac', container: 'flac', sample_rate_hz: 44100, bit_depth: 16, file_size_bytes: 2048, review_fields: review },
    match: { artist: { status: 'none', candidates: [] }, album: { status: 'none', candidates: [] } },
    review_fields: review,
    committed_track_id: null,
    committed_album_id: null,
    committed_artist_id: null,
    error_code: null,
    error_message: null,
    publish_blockers: review.length ? ['title_required'] : [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-01-01T00:15:00.000Z',
    ...overrides,
  };
}

export function readyAsset(): AdminTrack['assets'][number] {
  return {
    id: 'asset-1',
    container: 'flac',
    codec: 'flac',
    mime_type: 'audio/flac',
    sample_rate_hz: 44100,
    bit_depth: 16,
    channels: 2,
    bitrate_kbps: null,
    duration_seconds: 12,
    file_size_bytes: 2048,
    checksum_sha256: 'aa'.repeat(32),
    lossless: true,
    available: true,
    validation_state: 'ready',
  };
}

export function createFakeAdmin(options: {
  catalogAdmin?: boolean;
  artists?: AdminArtist[];
  albums?: AdminAlbum[];
  tracks?: AdminTrack[];
  imports?: AdminImport[];
} = {}): AdminCatalogApi & {
  calls: string[];
  lastPresign: PresignedUpload | null;
  setCatalogAdmin(value: boolean): void;
  setTrack(track: AdminTrack): void;
} {
  const calls: string[] = [];
  let catalogAdmin = options.catalogAdmin ?? true;
  const artists = options.artists ?? [sampleArtist()];
  const albums = options.albums ?? [sampleAlbum()];
  const tracks = options.tracks ?? [];
  const imports = options.imports ?? [];
  let lastPresign: PresignedUpload | null = null;
  const artworkJobs = new Map<string, { entityType: 'album' | 'artist'; entityId: string; ready: boolean }>();

  const api: ReturnType<typeof createFakeAdmin> = {
    calls,
    lastPresign,
    setCatalogAdmin(value) {
      catalogAdmin = value;
    },
    setTrack(track) {
      const index = tracks.findIndex(item => item.id === track.id);
      if (index >= 0) tracks[index] = track;
      else tracks.push(track);
    },
    async getCapabilities(): Promise<AdminCapabilities> {
      calls.push('getCapabilities');
      return { catalog_admin: catalogAdmin };
    },
    async listArtists(query?: string) {
      calls.push('listArtists');
      const needle = query?.trim().toLowerCase();
      return needle ? artists.filter(item => item.name.toLowerCase().includes(needle)) : [...artists];
    },
    async createArtist(input: CreateArtistInput) {
      calls.push('createArtist');
      const artist = sampleArtist({ id: id('artist'), name: input.name });
      artists.unshift(artist);
      return artist;
    },
    async updateArtist(artistId, input: CreateArtistInput) {
      calls.push('updateArtist');
      const artist = artists.find(item => item.id === artistId);
      if (!artist) throw new Error('missing artist');
      artist.name = input.name;
      return artist;
    },
    async listAlbums(query?: string) {
      calls.push('listAlbums');
      const needle = query?.trim().toLowerCase();
      return needle ? albums.filter(item => item.title.toLowerCase().includes(needle)) : [...albums];
    },
    async createAlbum(input: CreateAlbumInput) {
      calls.push('createAlbum');
      const album = sampleAlbum({ id: id('album'), title: input.title, primary_artist_id: input.primary_artist_id ?? null });
      albums.unshift(album);
      return album;
    },
    async updateAlbum(albumId, input: CreateAlbumInput) {
      calls.push('updateAlbum');
      const album = albums.find(item => item.id === albumId);
      if (!album) throw new Error('missing album');
      album.title = input.title;
      return album;
    },
    async listTracks() {
      calls.push('listTracks');
      return [...tracks];
    },
    async createTrack(input: CreateTrackInput) {
      calls.push('createTrack');
      const artist = artists.find(item => item.id === input.artist_ids?.[0]);
      const album = albums.find(item => item.id === input.album_id);
      const track = sampleTrack({
        id: id('track'),
        title: input.title,
        album_id: input.album_id ?? null,
        album_title: album?.title ?? null,
        artists: artist ? [{ id: artist.id, name: artist.name }] : [],
        track_number: input.track_number ?? null,
        genre: input.genre ?? null,
      });
      tracks.unshift(track);
      return track;
    },
    async getTrack(trackId: string) {
      calls.push('getTrack');
      const track = tracks.find(item => item.id === trackId);
      if (!track) throw new Error('missing track');
      return track;
    },
    async updateTrack(trackId: string, input: UpdateTrackInput) {
      calls.push('updateTrack');
      const track = tracks.find(item => item.id === trackId);
      if (!track) throw new Error('missing track');
      if (input.title) track.title = input.title;
      if (input.rights_holder) track.rights.rights_holder = input.rights_holder;
      if (input.license_source_ref) track.rights.license_source_ref = input.license_source_ref;
      if (input.rights_attested) {
        track.rights.attested = true;
        track.publish_blockers = track.publish_blockers.filter(item => item !== 'rights_attestation_required');
      }
      return track;
    },
    async deleteTrack() {
      calls.push('deleteTrack');
      return { deleted: true, unpublished: false };
    },
    async publishTrack(trackId: string) {
      calls.push('publishTrack');
      const track = tracks.find(item => item.id === trackId);
      if (!track) throw new Error('missing track');
      track.publication_state = 'published';
      track.available = true;
      return track;
    },
    async unpublishTrack(trackId: string) {
      calls.push('unpublishTrack');
      const track = tracks.find(item => item.id === trackId);
      if (!track) throw new Error('missing track');
      track.publication_state = 'draft';
      track.available = false;
      return track;
    },
    async initAudioUpload(_trackId: string, input: UploadInitInput): Promise<PresignedUpload> {
      calls.push('initAudioUpload');
      lastPresign = {
        upload_id: id('upload'),
        method: 'PUT',
        url: 'https://storage.test/presigned-audio',
        headers: { 'content-type': input.content_type },
        expires_at: '2026-01-01T00:15:00.000Z',
        object_key: null,
      };
      api.lastPresign = lastPresign;
      return lastPresign;
    },
    async initArtworkUpload(type, entityId, input: UploadInitInput): Promise<PresignedUpload> {
      calls.push('initArtworkUpload');
      lastPresign = {
        upload_id: id('upload'),
        method: 'PUT',
        url: 'https://storage.test/presigned-art',
        headers: { 'content-type': input.content_type },
        expires_at: '2026-01-01T00:15:00.000Z',
        object_key: null,
      };
      api.lastPresign = lastPresign;
      artworkJobs.set(lastPresign.upload_id, { entityType: type, entityId, ready: false });
      return lastPresign;
    },
    async getUpload(uploadId: string): Promise<UploadStatus> {
      calls.push('getUpload');
      const artwork = artworkJobs.get(uploadId);
      if (artwork) {
        return {
          upload_id: uploadId,
          media_type: 'artwork',
          entity_type: artwork.entityType,
          entity_id: artwork.entityId,
          status: artwork.ready ? 'uploaded' : 'pending',
          expected_filename: 'cover.jpg',
          expected_mime: 'image/jpeg',
          expected_size_bytes: 12,
          checksum_status: artwork.ready ? 'matched' : 'pending',
          job_id: 'job-art',
          job_status: artwork.ready ? 'ready' : 'pending',
          job_error: null,
          error_code: null,
          error_message: null,
          created_at: '2026-01-01T00:00:00.000Z',
          completed_at: artwork.ready ? '2026-01-01T00:01:00.000Z' : null,
        };
      }
      return {
        upload_id: uploadId,
        media_type: 'audio',
        entity_type: 'track',
        entity_id: 'track-1',
        status: 'uploaded',
        expected_filename: 'track.flac',
        expected_mime: 'audio/flac',
        expected_size_bytes: 12,
        checksum_status: 'pending',
        job_id: 'job-1',
        job_status: 'pending',
        job_error: null,
        error_code: null,
        error_message: null,
        created_at: '2026-01-01T00:00:00.000Z',
        completed_at: null,
      };
    },
    async completeUpload(uploadId: string) {
      calls.push('completeUpload');
      const artwork = artworkJobs.get(uploadId);
      if (artwork) {
        artwork.ready = true;
        const url = `https://cdn.example.test/artwork/${artwork.entityId}.jpg`;
        if (artwork.entityType === 'artist') {
          const artist = artists.find(item => item.id === artwork.entityId);
          if (artist) artist.image_url = url;
        } else {
          const album = albums.find(item => item.id === artwork.entityId);
          if (album) album.cover_url = url;
        }
      }
      return api.getUpload(uploadId);
    },
    async cancelUpload(uploadId: string) {
      calls.push('cancelUpload');
      return { ...(await api.getUpload(uploadId)), status: 'cancelled' };
    },
    async retryJob() {
      calls.push('retryJob');
      return api.getUpload('upload-retry');
    },
    async createImport(input: UploadInitInput): Promise<AdminImportCreateResponse> {
      calls.push('createImport');
      lastPresign = {
        upload_id: id('upload'),
        method: 'PUT',
        url: 'https://storage.test/presigned-audio',
        headers: { 'content-type': input.content_type },
        expires_at: '2026-01-01T00:15:00.000Z',
        object_key: null,
      };
      api.lastPresign = lastPresign;
      const row = sampleImport({
        id: id('import'),
        status: 'waiting_upload',
        original_filename: input.filename,
        expected_mime: input.content_type,
        expected_size_bytes: input.size_bytes,
        checksum_sha256: input.checksum_sha256,
        upload_id: lastPresign.upload_id,
        detected: {},
        effective: { title: input.filename.replace(/\.[^.]+$/, ''), review_fields: ['artist', 'album'] },
        review_fields: ['artist', 'album'],
      });
      imports.unshift(row);
      return { import: row, upload: lastPresign };
    },
    async listImports(status?: string) {
      calls.push('listImports');
      if (!status) return [...imports];
      if (status === 'processing') {
        return imports.filter(item => ['waiting_upload', 'uploading', 'verifying', 'probing', 'publishing'].includes(item.status));
      }
      return imports.filter(item => item.status === status);
    },
    async getImport(importId: string) {
      calls.push('getImport');
      const row = imports.find(item => item.id === importId);
      if (!row) throw new Error('missing import');
      if (row.status === 'probing') {
        row.status = 'published';
        row.committed_track_id = id('track');
        row.effective = {
          ...row.effective,
          title: row.original_filename.replace(/\.[^.]+$/, ''),
        };
        row.review_fields = [];
      }
      return row;
    },
    async updateImport(importId: string, input: UpdateImportInput) {
      calls.push('updateImport');
      const row = imports.find(item => item.id === importId);
      if (!row) throw new Error('missing import');
      row.override = { ...row.override, ...input };
      row.effective = { ...row.effective, ...input };
      row.review_fields = [!row.effective.title && 'title', !row.effective.artist && 'artist', !row.effective.album && 'album'].filter(Boolean) as string[];
      row.status = row.review_fields.length ? 'needs_review' : 'ready';
      return row;
    },
    async completeImport(importId: string) {
      calls.push('completeImport');
      const row = imports.find(item => item.id === importId);
      if (!row) throw new Error('missing import');
      row.status = 'probing';
      return row;
    },
    async cancelImport(importId: string) {
      calls.push('cancelImport');
      const row = imports.find(item => item.id === importId);
      if (!row) throw new Error('missing import');
      row.status = 'cancelled';
      return row;
    },
    async retryImport(importId: string) {
      calls.push('retryImport');
      const row = imports.find(item => item.id === importId);
      if (!row) throw new Error('missing import');
      row.status = 'probing';
      return row;
    },
    async commitImport(importId: string, _input: CommitImportInput) {
      calls.push('commitImport');
      const row = imports.find(item => item.id === importId);
      if (!row) throw new Error('missing import');
      row.status = 'published';
      row.committed_track_id = id('track');
      return row;
    },
    async commitImports(input: CommitImportInput & { import_ids: string[] }) {
      calls.push('commitImports');
      return Promise.all(input.import_ids.map(item => api.commitImport(item, input)));
    },
    async reconcileImports() {
      calls.push('reconcileImports');
      return { scanned: 0, enqueued: 0, skipped: 0, imports: [] };
    },
    async lookupArtistArtwork(artistId: string, options?: { force?: boolean }): Promise<ArtworkLookupResult> {
      calls.push('lookupArtistArtwork');
      const artist = artists.find(item => item.id === artistId);
      if (!artist) throw new Error('missing artist');
      if (!artist.image_url || options?.force) {
        artist.image_url = 'https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg';
      }
      return { id: artist.id, entity_type: 'artist', url: artist.image_url, found: Boolean(artist.image_url) };
    },
    async lookupAlbumArtwork(albumId: string, options?: { force?: boolean }): Promise<ArtworkLookupResult> {
      calls.push('lookupAlbumArtwork');
      const album = albums.find(item => item.id === albumId);
      if (!album) throw new Error('missing album');
      if (!album.cover_url || options?.force) {
        album.cover_url = 'https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg';
      }
      return { id: album.id, entity_type: 'album', url: album.cover_url, found: Boolean(album.cover_url) };
    },
    async lookupMissingArtwork(): Promise<ArtworkLookupBatchResult> {
      calls.push('lookupMissingArtwork');
      const artistResults = await Promise.all(
        artists.filter(item => !item.image_url).map(item => api.lookupArtistArtwork(item.id)),
      );
      const albumResults = await Promise.all(
        albums.filter(item => !item.cover_url).map(item => api.lookupAlbumArtwork(item.id)),
      );
      return {
        looked_up: artistResults.length + albumResults.length,
        filled: [...artistResults, ...albumResults].filter(item => item.found).length,
        skipped: [...artistResults, ...albumResults].filter(item => !item.found).length,
        artists: artistResults,
        albums: albumResults,
      };
    },
  };
  return api;
}

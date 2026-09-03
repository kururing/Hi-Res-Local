import type { CloudApiClient } from '../../api/client';
import type { AdminCatalogApi } from '../admin/contracts';
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
  AdminImportReconcileResponse,
  UpdateImportInput,
  CommitImportInput,
  ArtworkLookupResult,
  ArtworkLookupBatchResult,
} from '../admin/types';

export class WebAdminCatalogApi implements AdminCatalogApi {
  constructor(private readonly cloud: CloudApiClient) {}

  getCapabilities(): Promise<AdminCapabilities> {
    return this.cloud.request('/v1/admin/capabilities');
  }

  listArtists(query?: string): Promise<AdminArtist[]> {
    return this.cloud.request(`/v1/admin/catalog/artists${qs(query)}`);
  }

  createArtist(input: CreateArtistInput): Promise<AdminArtist> {
    return this.cloud.request('/v1/admin/catalog/artists', { method: 'POST', body: input });
  }

  updateArtist(id: string, input: CreateArtistInput): Promise<AdminArtist> {
    return this.cloud.request(`/v1/admin/catalog/artists/${id}`, { method: 'PATCH', body: input });
  }

  listAlbums(query?: string): Promise<AdminAlbum[]> {
    return this.cloud.request(`/v1/admin/catalog/albums${qs(query)}`);
  }

  createAlbum(input: CreateAlbumInput): Promise<AdminAlbum> {
    return this.cloud.request('/v1/admin/catalog/albums', { method: 'POST', body: input });
  }

  updateAlbum(id: string, input: CreateAlbumInput): Promise<AdminAlbum> {
    return this.cloud.request(`/v1/admin/catalog/albums/${id}`, { method: 'PATCH', body: input });
  }

  listTracks(query?: string): Promise<AdminTrack[]> {
    return this.cloud.request(`/v1/admin/catalog/tracks${qs(query)}`);
  }

  createTrack(input: CreateTrackInput): Promise<AdminTrack> {
    return this.cloud.request('/v1/admin/catalog/tracks', { method: 'POST', body: input });
  }

  getTrack(id: string): Promise<AdminTrack> {
    return this.cloud.request(`/v1/admin/catalog/tracks/${id}`);
  }

  updateTrack(id: string, input: UpdateTrackInput): Promise<AdminTrack> {
    return this.cloud.request(`/v1/admin/catalog/tracks/${id}`, { method: 'PATCH', body: input });
  }

  deleteTrack(id: string): Promise<{ deleted: boolean; unpublished: boolean }> {
    return this.cloud.request(`/v1/admin/catalog/tracks/${id}`, { method: 'DELETE' });
  }

  publishTrack(id: string): Promise<AdminTrack> {
    return this.cloud.request(`/v1/admin/catalog/tracks/${id}/publish`, { method: 'POST' });
  }

  unpublishTrack(id: string): Promise<AdminTrack> {
    return this.cloud.request(`/v1/admin/catalog/tracks/${id}/unpublish`, { method: 'POST' });
  }

  initAudioUpload(trackId: string, input: UploadInitInput, idempotencyKey?: string): Promise<PresignedUpload> {
    return this.cloud.request(`/v1/admin/catalog/tracks/${trackId}/audio-uploads`, {
      method: 'POST',
      body: input,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  initArtworkUpload(
    entityType: 'album' | 'artist',
    entityId: string,
    input: UploadInitInput,
    idempotencyKey?: string
  ): Promise<PresignedUpload> {
    return this.cloud.request(`/v1/admin/catalog/${entityType}s/${entityId}/artwork-uploads`, {
      method: 'POST',
      body: input,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  getUpload(uploadId: string): Promise<UploadStatus> {
    return this.cloud.request(`/v1/admin/uploads/${uploadId}`);
  }

  completeUpload(uploadId: string): Promise<UploadStatus> {
    return this.cloud.request(`/v1/admin/uploads/${uploadId}/complete`, { method: 'POST' });
  }

  cancelUpload(uploadId: string): Promise<UploadStatus> {
    return this.cloud.request(`/v1/admin/uploads/${uploadId}/cancel`, { method: 'POST' });
  }

  retryJob(jobId: string): Promise<UploadStatus> {
    return this.cloud.request(`/v1/admin/ingestion-jobs/${jobId}/retry`, { method: 'POST' });
  }

  createImport(input: UploadInitInput, idempotencyKey?: string): Promise<AdminImportCreateResponse> {
    return this.cloud.request('/v1/admin/imports', {
      method: 'POST',
      body: input,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  listImports(status?: string): Promise<AdminImport[]> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.cloud.request(`/v1/admin/imports${suffix}`);
  }

  getImport(id: string): Promise<AdminImport> {
    return this.cloud.request(`/v1/admin/imports/${id}`);
  }

  updateImport(id: string, input: UpdateImportInput): Promise<AdminImport> {
    return this.cloud.request(`/v1/admin/imports/${id}`, { method: 'PATCH', body: input });
  }

  completeImport(id: string): Promise<AdminImport> {
    return this.cloud.request(`/v1/admin/imports/${id}/complete`, { method: 'POST' });
  }

  cancelImport(id: string): Promise<AdminImport> {
    return this.cloud.request(`/v1/admin/imports/${id}/cancel`, { method: 'POST' });
  }

  retryImport(id: string): Promise<AdminImport> {
    return this.cloud.request(`/v1/admin/imports/${id}/retry`, { method: 'POST' });
  }

  commitImport(id: string, input: CommitImportInput): Promise<AdminImport> {
    return this.cloud.request(`/v1/admin/imports/${id}/commit`, { method: 'POST', body: input });
  }

  commitImports(input: CommitImportInput & { import_ids: string[] }): Promise<AdminImport[]> {
    return this.cloud.request('/v1/admin/imports/commit', { method: 'POST', body: input });
  }

  reconcileImports(): Promise<AdminImportReconcileResponse> {
    return this.cloud.request('/v1/admin/imports/reconcile', { method: 'POST' });
  }

  lookupArtistArtwork(id: string, options?: { force?: boolean }): Promise<ArtworkLookupResult> {
    const force = options?.force ? '?force=true' : '';
    return this.cloud.request(`/v1/admin/catalog/artists/${id}/artwork-lookup${force}`, { method: 'POST' });
  }

  lookupAlbumArtwork(id: string, options?: { force?: boolean }): Promise<ArtworkLookupResult> {
    const force = options?.force ? '?force=true' : '';
    return this.cloud.request(`/v1/admin/catalog/albums/${id}/artwork-lookup${force}`, { method: 'POST' });
  }

  lookupMissingArtwork(): Promise<ArtworkLookupBatchResult> {
    return this.cloud.request('/v1/admin/catalog/artwork-lookup', { method: 'POST' });
  }
}

function qs(query?: string): string {
  const value = query?.trim();
  return value ? `?q=${encodeURIComponent(value)}` : '';
}

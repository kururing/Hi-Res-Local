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
} from './types';

export interface AdminCatalogApi {
  getCapabilities(): Promise<AdminCapabilities>;
  listArtists(query?: string): Promise<AdminArtist[]>;
  createArtist(input: CreateArtistInput): Promise<AdminArtist>;
  updateArtist(id: string, input: CreateArtistInput): Promise<AdminArtist>;
  listAlbums(query?: string): Promise<AdminAlbum[]>;
  createAlbum(input: CreateAlbumInput): Promise<AdminAlbum>;
  updateAlbum(id: string, input: CreateAlbumInput): Promise<AdminAlbum>;
  listTracks(query?: string): Promise<AdminTrack[]>;
  createTrack(input: CreateTrackInput): Promise<AdminTrack>;
  getTrack(id: string): Promise<AdminTrack>;
  updateTrack(id: string, input: UpdateTrackInput): Promise<AdminTrack>;
  deleteTrack(id: string): Promise<{ deleted: boolean; unpublished: boolean }>;
  publishTrack(id: string): Promise<AdminTrack>;
  unpublishTrack(id: string): Promise<AdminTrack>;
  initAudioUpload(trackId: string, input: UploadInitInput, idempotencyKey?: string): Promise<PresignedUpload>;
  initArtworkUpload(
    entityType: 'album' | 'artist',
    entityId: string,
    input: UploadInitInput,
    idempotencyKey?: string
  ): Promise<PresignedUpload>;
  getUpload(uploadId: string): Promise<UploadStatus>;
  completeUpload(uploadId: string): Promise<UploadStatus>;
  cancelUpload(uploadId: string): Promise<UploadStatus>;
  retryJob(jobId: string): Promise<UploadStatus>;
  createImport(input: UploadInitInput, idempotencyKey?: string): Promise<AdminImportCreateResponse>;
  listImports(status?: string): Promise<AdminImport[]>;
  getImport(id: string): Promise<AdminImport>;
  updateImport(id: string, input: UpdateImportInput): Promise<AdminImport>;
  completeImport(id: string): Promise<AdminImport>;
  cancelImport(id: string): Promise<AdminImport>;
  retryImport(id: string): Promise<AdminImport>;
  commitImport(id: string, input: CommitImportInput): Promise<AdminImport>;
  commitImports(input: CommitImportInput & { import_ids: string[] }): Promise<AdminImport[]>;
  reconcileImports(): Promise<AdminImportReconcileResponse>;
  lookupArtistArtwork(id: string, options?: { force?: boolean }): Promise<ArtworkLookupResult>;
  lookupAlbumArtwork(id: string, options?: { force?: boolean }): Promise<ArtworkLookupResult>;
  lookupMissingArtwork(): Promise<ArtworkLookupBatchResult>;
}

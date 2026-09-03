export interface AdminCapabilities {
  catalog_admin: boolean;
  admin?: boolean;
}

export interface AdminArtist {
  id: string;
  name: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAlbum {
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

export interface AdminAsset {
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

export interface AdminRights {
  rights_holder: string | null;
  license_source_ref: string | null;
  territory_scope: string | null;
  attested: boolean;
  attested_by: string | null;
  attested_at: string | null;
}

export interface AdminTrack {
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
  assets: AdminAsset[];
  rights: AdminRights;
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

export interface CreateArtistInput {
  name: string;
}

export interface CreateAlbumInput {
  title: string;
  primary_artist_id?: string | null;
  year?: number | null;
  genre?: string | null;
}

export interface CreateTrackInput {
  title: string;
  album_id?: string | null;
  artist_ids?: string[];
  track_number?: number | null;
  disc_number?: number | null;
  genre?: string | null;
}

export interface UpdateTrackInput extends Partial<CreateTrackInput> {
  rights_holder?: string;
  license_source_ref?: string;
  territory_scope?: string | null;
  rights_attested?: boolean;
}

export interface UploadInitInput {
  filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
}

export interface PresignedUpload {
  upload_id: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expires_at: string;
  object_key: null;
}

export interface UploadStatus {
  upload_id: string;
  media_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  expected_filename: string;
  expected_mime: string;
  expected_size_bytes: number;
  checksum_status: string;
  job_id: string | null;
  job_status: string | null;
  job_error: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export type AdminImportStatus =
  | 'waiting_upload'
  | 'uploading'
  | 'verifying'
  | 'probing'
  | 'needs_review'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'duplicate'
  | 'failed'
  | 'cancelled';

export interface AdminImportMetadata {
  title?: string | null;
  artist?: string | null;
  album_artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  track?: number | null;
  disc?: number | null;
  codec?: string | null;
  container?: string | null;
  sample_rate_hz?: number | null;
  bit_depth?: number | null;
  channels?: number | null;
  file_size_bytes?: number | null;
  lossless?: boolean;
  hi_res?: boolean;
  dsd?: boolean;
  artwork_public_url?: string | null;
  review_fields?: string[];
  selected_artist_id?: string | null;
  selected_album_id?: string | null;
  rights_holder?: string | null;
  license_source_ref?: string | null;
  territory_scope?: string | null;
  rights_attested?: boolean;
  [key: string]: unknown;
}

export interface AdminImportMatch {
  artist?: { status: 'none' | 'exact' | 'ambiguous'; candidates: Array<{ id: string; name: string }> };
  album?: { status: 'none' | 'exact' | 'ambiguous'; candidates: Array<{ id: string; title: string; artist_name: string | null }> };
}

export interface AdminImport {
  id: string;
  status: AdminImportStatus;
  original_filename: string;
  expected_mime: string;
  expected_size_bytes: number;
  checksum_sha256: string;
  upload_id: string | null;
  job_id: string | null;
  job_status: string | null;
  detected: AdminImportMetadata;
  override: AdminImportMetadata;
  effective: AdminImportMetadata;
  match: AdminImportMatch;
  review_fields: string[];
  committed_track_id: string | null;
  committed_album_id: string | null;
  committed_artist_id: string | null;
  error_code: string | null;
  error_message: string | null;
  publish_blockers: string[];
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface AdminImportCreateResponse {
  import: AdminImport;
  upload: PresignedUpload;
}

export interface AdminImportReconcileResponse {
  scanned: number;
  enqueued: number;
  skipped: number;
  imports: AdminImport[];
}

export interface UpdateImportInput {
  title?: string | null;
  artist?: string | null;
  album_artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  track?: number | null;
  disc?: number | null;
  selected_artist_id?: string | null;
  selected_album_id?: string | null;
  rights_holder?: string;
  license_source_ref?: string;
  territory_scope?: string | null;
  rights_attested?: boolean;
}

export interface CommitImportInput {
  import_ids?: string[];
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  selected_artist_id?: string | null;
  selected_album_id?: string | null;
  rights_holder?: string;
  license_source_ref?: string;
  territory_scope?: string | null;
  rights_attested?: boolean;
}

export interface ArtworkLookupResult {
  id: string;
  entity_type: 'artist' | 'album';
  url: string | null;
  found: boolean;
}

export interface ArtworkLookupBatchResult {
  looked_up: number;
  filled: number;
  skipped: number;
  artists: ArtworkLookupResult[];
  albums: ArtworkLookupResult[];
}

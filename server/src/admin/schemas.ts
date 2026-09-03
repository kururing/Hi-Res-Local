import { Type } from '@sinclair/typebox';
import { ErrorEnvelopeSchema, UuidParams } from '../http/schemas.js';

export const AdminErrorResponses = {
  400: ErrorEnvelopeSchema,
  401: ErrorEnvelopeSchema,
  403: ErrorEnvelopeSchema,
  404: ErrorEnvelopeSchema,
  409: ErrorEnvelopeSchema,
};

export const CapabilitiesSchema = Type.Object({
  catalog_admin: Type.Boolean(),
  admin: Type.Boolean(),
});

export const AdminListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
});

export const ArtworkLookupQuery = Type.Object({
  force: Type.Optional(Type.String({ enum: ['true', 'false'] })),
});

export const AdminArtistViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  image_url: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const ArtworkLookupViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  entity_type: Type.Union([Type.Literal('artist'), Type.Literal('album')]),
  url: Type.Union([Type.String(), Type.Null()]),
  found: Type.Boolean(),
});

export const ArtworkLookupBatchViewSchema = Type.Object({
  looked_up: Type.Integer(),
  filled: Type.Integer(),
  skipped: Type.Integer(),
  artists: Type.Array(ArtworkLookupViewSchema),
  albums: Type.Array(ArtworkLookupViewSchema),
});

export const AdminAlbumViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  primary_artist_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  artist_name: Type.Union([Type.String(), Type.Null()]),
  year: Type.Union([Type.Integer(), Type.Null()]),
  genre: Type.Union([Type.String(), Type.Null()]),
  cover_url: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const AdminAssetViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  container: Type.String(),
  codec: Type.String(),
  mime_type: Type.Union([Type.String(), Type.Null()]),
  sample_rate_hz: Type.Integer(),
  bit_depth: Type.Union([Type.Integer(), Type.Null()]),
  channels: Type.Integer(),
  bitrate_kbps: Type.Union([Type.Integer(), Type.Null()]),
  duration_seconds: Type.Number(),
  file_size_bytes: Type.Integer(),
  checksum_sha256: Type.String(),
  lossless: Type.Boolean(),
  available: Type.Boolean(),
  validation_state: Type.String(),
});

export const AdminRightsViewSchema = Type.Object({
  rights_holder: Type.Union([Type.String(), Type.Null()]),
  license_source_ref: Type.Union([Type.String(), Type.Null()]),
  territory_scope: Type.Union([Type.String(), Type.Null()]),
  attested: Type.Boolean(),
  attested_by: Type.Union([Type.String(), Type.Null()]),
  attested_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export const AdminTrackViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  album_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  album_title: Type.Union([Type.String(), Type.Null()]),
  artists: Type.Array(Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  })),
  track_number: Type.Union([Type.Integer(), Type.Null()]),
  disc_number: Type.Union([Type.Integer(), Type.Null()]),
  duration_seconds: Type.Number(),
  genre: Type.Union([Type.String(), Type.Null()]),
  publication_state: Type.Union([Type.Literal('draft'), Type.Literal('published')]),
  available: Type.Boolean(),
  deleted: Type.Boolean(),
  assets: Type.Array(AdminAssetViewSchema),
  rights: AdminRightsViewSchema,
  ingestion: Type.Object({
    latest_upload_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    latest_upload_status: Type.Union([Type.String(), Type.Null()]),
    latest_job_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    latest_job_status: Type.Union([Type.String(), Type.Null()]),
    latest_job_error: Type.Union([Type.String(), Type.Null()]),
  }),
  publish_blockers: Type.Array(Type.String()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const UploadInitBodySchema = Type.Object({
  filename: Type.String({ minLength: 1, maxLength: 255 }),
  content_type: Type.String({ minLength: 1, maxLength: 127 }),
  size_bytes: Type.Integer({ minimum: 1 }),
  checksum_sha256: Type.String({ minLength: 16, maxLength: 128 }),
});

export const PresignResponseSchema = Type.Object({
  upload_id: Type.String({ format: 'uuid' }),
  method: Type.Literal('PUT'),
  url: Type.String(),
  headers: Type.Record(Type.String(), Type.String()),
  expires_at: Type.String({ format: 'date-time' }),
  object_key: Type.Null(),
});

export const UploadStatusSchema = Type.Object({
  upload_id: Type.String({ format: 'uuid' }),
  media_type: Type.String(),
  entity_type: Type.String(),
  entity_id: Type.String({ format: 'uuid' }),
  status: Type.String(),
  expected_filename: Type.String(),
  expected_mime: Type.String(),
  expected_size_bytes: Type.Integer(),
  checksum_status: Type.String(),
  job_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  job_status: Type.Union([Type.String(), Type.Null()]),
  job_error: Type.Union([Type.String(), Type.Null()]),
  error_code: Type.Union([Type.String(), Type.Null()]),
  error_message: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
  completed_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

export const TrackIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const UploadIdParams = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
});

export const JobIdParams = Type.Object({
  jobId: Type.String({ format: 'uuid' }),
});

export const ImportIdParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const ImportListQuery = Type.Object({
  status: Type.Optional(Type.String({ maxLength: 80 })),
});

const ImportJson = Type.Object({}, { additionalProperties: true });

export const ImportViewSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: Type.String(),
  original_filename: Type.String(),
  expected_mime: Type.String(),
  expected_size_bytes: Type.Integer(),
  checksum_sha256: Type.String(),
  upload_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  job_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  job_status: Type.Union([Type.String(), Type.Null()]),
  detected: ImportJson,
  override: ImportJson,
  effective: ImportJson,
  match: ImportJson,
  review_fields: Type.Array(Type.String()),
  committed_track_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  committed_album_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  committed_artist_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  error_code: Type.Union([Type.String(), Type.Null()]),
  error_message: Type.Union([Type.String(), Type.Null()]),
  publish_blockers: Type.Array(Type.String()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
  expires_at: Type.String({ format: 'date-time' }),
});

export const ImportCreateResponseSchema = Type.Object({
  import: ImportViewSchema,
  upload: PresignResponseSchema,
});

export const ImportReconcileResponseSchema = Type.Object({
  scanned: Type.Integer(),
  enqueued: Type.Integer(),
  skipped: Type.Integer(),
  imports: Type.Array(ImportViewSchema),
});

export const ImportBatchBodySchema = Type.Object({
  import_ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 50 }),
  rights_holder: Type.Optional(Type.String()),
  license_source_ref: Type.Optional(Type.String()),
  territory_scope: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  rights_attested: Type.Optional(Type.Boolean()),
});

export { UuidParams };

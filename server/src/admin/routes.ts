import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireCatalogAdmin } from './guard.js';
import {
  AdminAlbumViewSchema,
  AdminArtistViewSchema,
  AdminErrorResponses,
  ArtworkLookupBatchViewSchema,
  ArtworkLookupQuery,
  ArtworkLookupViewSchema,
  AdminListQuery,
  AdminTrackViewSchema,
  CapabilitiesSchema,
  ImportBatchBodySchema,
  ImportCreateResponseSchema,
  ImportIdParams,
  ImportListQuery,
  ImportReconcileResponseSchema,
  ImportViewSchema,
  JobIdParams,
  PresignResponseSchema,
  TrackIdParams,
  UploadIdParams,
  UploadInitBodySchema,
  UploadStatusSchema,
  UuidParams,
} from './schemas.js';

const LooseObject = Type.Object({}, { additionalProperties: true });

export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/admin/capabilities', {
    schema: {
      tags: ['Admin'],
      summary: 'Return catalog admin capability for the current user',
      response: { 200: CapabilitiesSchema, 401: AdminErrorResponses[401] },
    },
    preHandler: app.authenticate,
  }, async (request) => app.rolesService.capabilities(request.authUser!.id));

  const adminOnly = { preHandler: requireCatalogAdmin };

  app.addHook('onRoute', (route) => {
    const method = Array.isArray(route.method) ? route.method.join(',') : String(route.method);
    if (!route.url.startsWith('/v1/admin')) return;
    if (!/\b(POST|PUT|PATCH|DELETE)\b/.test(method)) return;
    route.config = {
      ...route.config,
      rateLimit: {
        max: app.config.adminRateLimitMax,
        timeWindow: app.config.authRateLimitWindowMs,
      },
    };
  });

  app.get('/v1/admin/catalog/artists', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'List artists for catalog administration',
      querystring: AdminListQuery,
      response: { 200: Type.Array(AdminArtistViewSchema), ...AdminErrorResponses },
    },
  }, async (request) => app.adminCatalogService.listArtists(request.query.q));

  app.post('/v1/admin/catalog/artists', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Create an artist',
      body: LooseObject,
      response: { 201: AdminArtistViewSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminCatalogService.createArtist(request.body, request.authUser!.id, request.id),
  ));

  app.patch('/v1/admin/catalog/artists/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Update an artist',
      params: UuidParams,
      body: LooseObject,
      response: { 200: AdminArtistViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.updateArtist(request.params.id, request.body, request.authUser!.id, request.id));

  app.get('/v1/admin/catalog/albums', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'List albums for catalog administration',
      querystring: AdminListQuery,
      response: { 200: Type.Array(AdminAlbumViewSchema), ...AdminErrorResponses },
    },
  }, async (request) => app.adminCatalogService.listAlbums(request.query.q));

  app.post('/v1/admin/catalog/albums', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Create an album',
      body: LooseObject,
      response: { 201: AdminAlbumViewSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminCatalogService.createAlbum(request.body, request.authUser!.id, request.id),
  ));

  app.patch('/v1/admin/catalog/albums/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Update an album',
      params: UuidParams,
      body: LooseObject,
      response: { 200: AdminAlbumViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.updateAlbum(request.params.id, request.body, request.authUser!.id, request.id));

  app.post('/v1/admin/catalog/artists/:id/artwork-lookup', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Store a remote artist image URL without downloading the file',
      params: UuidParams,
      querystring: ArtworkLookupQuery,
      response: { 200: ArtworkLookupViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.lookupArtistArtwork(
      request.params.id,
      request.authUser!.id,
      request.id,
      request.query.force === 'true',
    ));

  app.post('/v1/admin/catalog/albums/:id/artwork-lookup', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Store a remote album cover URL without downloading the file',
      params: UuidParams,
      querystring: ArtworkLookupQuery,
      response: { 200: ArtworkLookupViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.lookupAlbumArtwork(
      request.params.id,
      request.authUser!.id,
      request.id,
      request.query.force === 'true',
    ));

  app.post('/v1/admin/catalog/artwork-lookup', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Look up missing artist and album artwork URLs from iTunes',
      response: { 200: ArtworkLookupBatchViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.lookupMissingArtwork(request.authUser!.id, request.id));

  app.get('/v1/admin/catalog/tracks', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'List track drafts and published tracks',
      querystring: AdminListQuery,
      response: { 200: Type.Array(AdminTrackViewSchema), ...AdminErrorResponses },
    },
  }, async (request) => app.adminCatalogService.listTracks(request.query.q));

  app.post('/v1/admin/catalog/tracks', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Create a draft track',
      body: LooseObject,
      response: { 201: AdminTrackViewSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminCatalogService.createTrack(request.body, request.authUser!.id, request.id),
  ));

  app.get('/v1/admin/catalog/tracks/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Get an admin track including ingestion and rights',
      params: TrackIdParams,
      response: { 200: AdminTrackViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminCatalogService.getTrack(request.params.id));

  app.patch('/v1/admin/catalog/tracks/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Update draft track metadata or rights',
      params: TrackIdParams,
      body: LooseObject,
      response: { 200: AdminTrackViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.updateTrack(request.params.id, request.body, request.authUser!.id, request.id));

  app.delete('/v1/admin/catalog/tracks/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Delete a draft or unpublish a referenced track',
      params: TrackIdParams,
      response: {
        200: Type.Object({ deleted: Type.Boolean(), unpublished: Type.Boolean() }),
        ...AdminErrorResponses,
      },
    },
  }, async (request) =>
    app.adminCatalogService.deleteTrack(request.params.id, request.authUser!.id, request.id));

  app.post('/v1/admin/catalog/tracks/:id/publish', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Publish a track after validation and rights attestation',
      params: TrackIdParams,
      response: { 200: AdminTrackViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.publish(request.params.id, request.authUser!.id, request.id));

  app.post('/v1/admin/catalog/tracks/:id/unpublish', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Unpublish a track and revoke streaming',
      params: TrackIdParams,
      response: { 200: AdminTrackViewSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminCatalogService.unpublish(request.params.id, request.authUser!.id, request.id));

  app.post('/v1/admin/catalog/tracks/:id/audio-uploads', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Initialize a presigned audio upload',
      params: TrackIdParams,
      body: UploadInitBodySchema,
      response: { 201: PresignResponseSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminUploadService.initAudio(
      request.params.id,
      request.body,
      request.authUser!.id,
      request.id,
      headerIdempotency(request.headers['idempotency-key']),
    ),
  ));

  app.post('/v1/admin/catalog/albums/:id/artwork-uploads', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Initialize a presigned album artwork upload',
      params: UuidParams,
      body: UploadInitBodySchema,
      response: { 201: PresignResponseSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminUploadService.initArtwork(
      'album',
      request.params.id,
      request.body,
      request.authUser!.id,
      request.id,
      headerIdempotency(request.headers['idempotency-key']),
    ),
  ));

  app.post('/v1/admin/catalog/artists/:id/artwork-uploads', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Initialize a presigned artist artwork upload',
      params: UuidParams,
      body: UploadInitBodySchema,
      response: { 201: PresignResponseSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminUploadService.initArtwork(
      'artist',
      request.params.id,
      request.body,
      request.authUser!.id,
      request.id,
      headerIdempotency(request.headers['idempotency-key']),
    ),
  ));

  app.get('/v1/admin/uploads/:uploadId', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Get upload and ingestion status',
      params: UploadIdParams,
      response: { 200: UploadStatusSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminUploadService.getUpload(request.params.uploadId, request.authUser!.id));

  app.post('/v1/admin/uploads/:uploadId/complete', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Verify an uploaded object and enqueue ingestion',
      params: UploadIdParams,
      response: { 200: UploadStatusSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminUploadService.complete(request.params.uploadId, request.authUser!.id, request.id));

  app.post('/v1/admin/uploads/:uploadId/cancel', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Cancel an upload and delete the orphan object',
      params: UploadIdParams,
      response: { 200: UploadStatusSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminUploadService.cancel(request.params.uploadId, request.authUser!.id, request.id));

  app.post('/v1/admin/imports', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Create an upload-first audio import and receive a presigned PUT',
      body: UploadInitBodySchema,
      response: { 201: ImportCreateResponseSchema, ...AdminErrorResponses },
    },
  }, async (request, reply) => reply.code(201).send(
    await app.adminImportService.create(
      request.body,
      request.authUser!.id,
      request.id,
      headerIdempotency(request.headers['idempotency-key']),
    ),
  ));

  app.get('/v1/admin/imports', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'List recent audio imports for the current admin',
      querystring: ImportListQuery,
      response: { 200: Type.Array(ImportViewSchema), ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.list(request.authUser!.id, request.query.status));

  app.post('/v1/admin/imports/reconcile', {
    ...adminOnly,
    config: {
      rateLimit: {
        max: app.config.adminRateLimitMax,
        timeWindow: app.config.authRateLimitWindowMs,
      },
    },
    schema: {
      tags: ['Admin'],
      summary: 'Scan unlinked audio objects in the audio bucket and enqueue auto-import',
      response: { 200: ImportReconcileResponseSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.reconcile(request.authUser!.id, request.id));

  app.post('/v1/admin/imports/commit', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Commit and publish multiple reviewed imports',
      body: ImportBatchBodySchema,
      response: { 200: Type.Array(ImportViewSchema), ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.commitMany(
    request.body.import_ids,
    request.body as Record<string, unknown>,
    request.authUser!.id,
    request.id,
  ));

  app.get('/v1/admin/imports/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Get one audio import including detected metadata',
      params: ImportIdParams,
      response: { 200: ImportViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.get(request.params.id, request.authUser!.id));

  app.patch('/v1/admin/imports/:id', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Update import metadata overrides and match choices',
      params: ImportIdParams,
      body: LooseObject,
      response: { 200: ImportViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.patch(
    request.params.id,
    request.body,
    request.authUser!.id,
    request.id,
  ));

  app.post('/v1/admin/imports/:id/complete', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Verify an imported object and enqueue probing',
      params: ImportIdParams,
      response: { 200: ImportViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.complete(request.params.id, request.authUser!.id, request.id));

  app.post('/v1/admin/imports/:id/cancel', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Cancel an unfinished audio import',
      params: ImportIdParams,
      response: { 200: ImportViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.cancel(request.params.id, request.authUser!.id, request.id));

  app.post('/v1/admin/imports/:id/retry', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Retry a failed audio import without clearing overrides',
      params: ImportIdParams,
      response: { 200: ImportViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.retry(request.params.id, request.authUser!.id, request.id));

  app.post('/v1/admin/imports/:id/commit', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Commit one reviewed import into the catalog and publish',
      params: ImportIdParams,
      body: LooseObject,
      response: { 200: ImportViewSchema, ...AdminErrorResponses },
    },
  }, async (request) => app.adminImportService.commit(
    request.params.id,
    request.body ?? {},
    request.authUser!.id,
    request.id,
  ));

  app.post('/v1/admin/ingestion-jobs/:jobId/retry', {
    ...adminOnly,
    schema: {
      tags: ['Admin'],
      summary: 'Retry a failed ingestion job',
      params: JobIdParams,
      response: { 200: UploadStatusSchema, ...AdminErrorResponses },
    },
  }, async (request) =>
    app.adminUploadService.retryJob(request.params.jobId, request.authUser!.id, request.id));
};

function headerIdempotency(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key && key.length <= 128 ? key : null;
}

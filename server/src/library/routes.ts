import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { FrontendTrackSchema } from '../catalog/schemas.js';
import { ErrorEnvelopeSchema, TrackIdParams } from '../http/schemas.js';

const LibraryStatsSchema = Type.Object({
  total_tracks: Type.Integer(),
  total_artists: Type.Integer(),
  total_albums: Type.Integer(),
  total_duration_secs: Type.Number(),
  total_size_bytes: Type.Integer(),
});

const LibraryRootSchema = Type.Object({
  id: Type.String(),
  path: Type.String(),
  name: Type.String(),
  is_active: Type.Boolean(),
  last_scanned_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.String(),
});

const ChangesQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});

const LibraryChangeSchema = Type.Object({
  change_id: Type.String(),
  entity_type: Type.Literal('track'),
  operation: Type.Union([Type.Literal('upsert'), Type.Literal('delete')]),
  entity_id: Type.String({ format: 'uuid' }),
  created_at: Type.String({ format: 'date-time' }),
});

const LibraryChangesResponseSchema = Type.Object({
  changes: Type.Array(LibraryChangeSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
  has_more: Type.Boolean(),
});

export const libraryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/library/tracks', {
    schema: {
      tags: ['Library'],
      summary: 'List tracks in the current user library',
      response: {
        200: Type.Array(FrontendTrackSchema),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.libraryService.listTracks(request.authUser!.id));

  app.get('/v1/library/stats', {
    schema: {
      tags: ['Library'],
      summary: 'Library totals for the current user',
      response: {
        200: LibraryStatsSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.libraryService.stats(request.authUser!.id));

  app.get('/v1/library/roots', {
    schema: {
      tags: ['Library'],
      summary: 'Cloud libraries have no local filesystem roots',
      response: {
        200: Type.Array(LibraryRootSchema),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async () => app.libraryService.roots());

  app.put('/v1/library/tracks/:trackId', {
    schema: {
      tags: ['Library'],
      summary: 'Add a catalog track to the current user library',
      params: TrackIdParams,
      response: {
        204: Type.Null(),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request, reply) => {
    await app.libraryService.addTrack(request.authUser!.id, request.params.trackId);
    return reply.code(204).send(null);
  });

  app.delete('/v1/library/tracks/:trackId', {
    schema: {
      tags: ['Library'],
      summary: 'Remove a track from the current user library',
      params: TrackIdParams,
      response: {
        204: Type.Null(),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request, reply) => {
    await app.libraryService.removeTrack(request.authUser!.id, request.params.trackId);
    return reply.code(204).send(null);
  });

  app.get('/v1/library/changes', {
    schema: {
      tags: ['Library'],
      summary: 'Cursor-based library change log',
      querystring: ChangesQuerySchema,
      response: {
        200: LibraryChangesResponseSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.libraryService.listChanges(request.authUser!.id, request.query.cursor, request.query.limit));
};

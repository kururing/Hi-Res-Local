import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema, UuidParams } from '../http/schemas.js';
import {
  BackendPlaylistSchema,
  CreatePlaylistBodySchema,
  PatchPlaylistBodySchema,
  PlaylistDetailsSchema,
  PlaylistTrackIdsBodySchema,
} from './schemas.js';

export const playlistRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/playlists', {
    schema: {
      tags: ['Playlists'],
      summary: 'List playlists for the current user',
      response: {
        200: Type.Array(BackendPlaylistSchema),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.playlistService.list(request.authUser!.id));

  app.post('/v1/playlists', {
    schema: {
      tags: ['Playlists'],
      summary: 'Create a playlist',
      body: CreatePlaylistBodySchema,
      response: {
        200: BackendPlaylistSchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.playlistService.create(request.authUser!.id, request.body));

  app.get('/v1/playlists/:id', {
    schema: {
      tags: ['Playlists'],
      summary: 'Get a playlist and its tracks',
      params: UuidParams,
      response: {
        200: PlaylistDetailsSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.playlistService.get(request.authUser!.id, request.params.id));

  app.patch('/v1/playlists/:id', {
    schema: {
      tags: ['Playlists'],
      summary: 'Update playlist fields that are present',
      params: UuidParams,
      body: PatchPlaylistBodySchema,
      response: {
        200: BackendPlaylistSchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.playlistService.update(request.authUser!.id, request.params.id, request.body));

  app.delete('/v1/playlists/:id', {
    schema: {
      tags: ['Playlists'],
      summary: 'Delete a playlist',
      params: UuidParams,
      response: {
        200: Type.Boolean(),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.playlistService.delete(request.authUser!.id, request.params.id));

  app.post('/v1/playlists/:id/tracks', {
    schema: {
      tags: ['Playlists'],
      summary: 'Append catalog tracks to a playlist',
      params: UuidParams,
      body: PlaylistTrackIdsBodySchema,
      response: {
        200: Type.Integer(),
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.playlistService.addTracks(request.authUser!.id, request.params.id, request.body.track_ids));

  app.delete('/v1/playlists/:id/tracks', {
    schema: {
      tags: ['Playlists'],
      summary: 'Remove tracks from a playlist',
      params: UuidParams,
      body: PlaylistTrackIdsBodySchema,
      response: {
        200: Type.Integer(),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.playlistService.removeTracks(request.authUser!.id, request.params.id, request.body.track_ids));

  app.put('/v1/playlists/:id/order', {
    schema: {
      tags: ['Playlists'],
      summary: 'Replace playlist order. Membership must match exactly.',
      params: UuidParams,
      body: PlaylistTrackIdsBodySchema,
      response: {
        204: Type.Null(),
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request, reply) => {
    await app.playlistService.reorderTracks(request.authUser!.id, request.params.id, request.body.track_ids);
    return reply.code(204).send(null);
  });
};

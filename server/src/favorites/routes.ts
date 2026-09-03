import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema, UuidParams } from '../http/schemas.js';
import {
  FavoriteAlbumBodySchema,
  FavoriteAlbumSchema,
  FavoriteArtistBodySchema,
} from './schemas.js';

export const favoritesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.put('/v1/favorites/tracks/:id', {
    schema: {
      tags: ['Favorites'],
      summary: 'Favorite a catalog track',
      params: UuidParams,
      response: {
        204: Type.Null(),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request, reply) => {
    await app.favoritesService.setTrackFavorite(request.authUser!.id, request.params.id, true);
    return reply.code(204).send(null);
  });

  app.delete('/v1/favorites/tracks/:id', {
    schema: {
      tags: ['Favorites'],
      summary: 'Unfavorite a catalog track',
      params: UuidParams,
      response: {
        204: Type.Null(),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request, reply) => {
    await app.favoritesService.setTrackFavorite(request.authUser!.id, request.params.id, false);
    return reply.code(204).send(null);
  });

  app.get('/v1/favorites/albums', {
    schema: {
      tags: ['Favorites'],
      summary: 'List favorite albums',
      response: {
        200: Type.Array(FavoriteAlbumSchema),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.favoritesService.listAlbums(request.authUser!.id));

  app.put('/v1/favorites/albums', {
    schema: {
      tags: ['Favorites'],
      summary: 'Favorite an album by title and artist',
      body: FavoriteAlbumBodySchema,
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
    await app.favoritesService.setAlbumFavorite(
      request.authUser!.id,
      request.body.album_title,
      request.body.artist_name,
      true,
    );
    return reply.code(204).send(null);
  });

  app.delete('/v1/favorites/albums', {
    schema: {
      tags: ['Favorites'],
      summary: 'Unfavorite an album by title and artist',
      body: FavoriteAlbumBodySchema,
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
    await app.favoritesService.setAlbumFavorite(
      request.authUser!.id,
      request.body.album_title,
      request.body.artist_name,
      false,
    );
    return reply.code(204).send(null);
  });

  app.get('/v1/favorites/artists', {
    schema: {
      tags: ['Favorites'],
      summary: 'List favorite artist names',
      response: {
        200: Type.Array(Type.String()),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.favoritesService.listArtists(request.authUser!.id));

  app.put('/v1/favorites/artists', {
    schema: {
      tags: ['Favorites'],
      summary: 'Favorite an artist by name',
      body: FavoriteArtistBodySchema,
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
    await app.favoritesService.setArtistFavorite(request.authUser!.id, request.body.artist_name, true);
    return reply.code(204).send(null);
  });

  app.delete('/v1/favorites/artists', {
    schema: {
      tags: ['Favorites'],
      summary: 'Unfavorite an artist by name',
      body: FavoriteArtistBodySchema,
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
    await app.favoritesService.setArtistFavorite(request.authUser!.id, request.body.artist_name, false);
    return reply.code(204).send(null);
  });
};

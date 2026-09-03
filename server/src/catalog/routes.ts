import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema, UuidParams } from '../http/schemas.js';
import {
  FrontendAlbumSchema,
  FrontendArtistSchema,
  FrontendLibraryStatsSchema,
  FrontendTrackSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  CatalogListQuerySchema,
  AlbumListPageSchema,
  ArtistListPageSchema,
  TrackListPageSchema,
} from './schemas.js';

/**
 * Catalog reads are authenticated unless `CATALOG_PUBLIC=true`.
 * Streaming always requires authentication regardless of that flag.
 */
export const catalogRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const catalogAuth = async (request: unknown, reply: unknown) => {
    const req = request as { headers: { authorization?: string } };
    if (!app.config.catalogPublic) {
      await app.authenticate(request as never, reply as never);
      return;
    }
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ') && header.trim().length > 7) {
      await app.authenticate(request as never, reply as never);
    }
  };

  app.get('/v1/catalog/tracks', {
    schema: {
      tags: ['Catalog'],
      summary: 'List published tracks for the shared cloud catalog',
      querystring: CatalogListQuerySchema,
      response: {
        200: Type.Union([Type.Array(FrontendTrackSchema), TrackListPageSchema]),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.listTracks(request.authUser?.id, {
    limit: request.query.limit,
    cursor: request.query.cursor,
  }));

  app.get('/v1/catalog/artists', {
    schema: {
      tags: ['Catalog'],
      summary: 'List published artists',
      querystring: CatalogListQuerySchema,
      response: {
        200: ArtistListPageSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.listArtists({
    limit: request.query.limit,
    cursor: request.query.cursor,
  }));

  app.get('/v1/catalog/albums', {
    schema: {
      tags: ['Catalog'],
      summary: 'List published albums',
      querystring: CatalogListQuerySchema,
      response: {
        200: AlbumListPageSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.listAlbums({
    limit: request.query.limit,
    cursor: request.query.cursor,
  }));

  app.get('/v1/catalog/stats', {
    schema: {
      tags: ['Catalog'],
      summary: 'Published catalog totals',
      response: {
        200: FrontendLibraryStatsSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async () => app.catalogService.stats());

  app.get('/v1/catalog/search', {
    schema: {
      tags: ['Catalog'],
      summary: 'Search artists, albums, and tracks',
      querystring: SearchQuerySchema,
      response: {
        200: SearchResponseSchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.search(request.query, request.authUser?.id));

  app.get('/v1/catalog/tracks/:id', {
    schema: {
      tags: ['Catalog'],
      summary: 'Get a track',
      params: UuidParams,
      response: {
        200: FrontendTrackSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.getTrack(request.params.id, request.authUser?.id));

  app.get('/v1/catalog/albums/:id', {
    schema: {
      tags: ['Catalog'],
      summary: 'Get an album with tracks',
      params: UuidParams,
      response: {
        200: FrontendAlbumSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.getAlbum(request.params.id, request.authUser?.id));

  app.get('/v1/catalog/artists/:id', {
    schema: {
      tags: ['Catalog'],
      summary: 'Get an artist with albums',
      params: UuidParams,
      response: {
        200: FrontendArtistSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.getArtist(request.params.id));

  app.get('/v1/catalog/albums/:id/tracks', {
    schema: {
      tags: ['Catalog'],
      summary: 'List tracks on an album',
      params: UuidParams,
      response: {
        200: Type.Array(FrontendTrackSchema),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.listAlbumTracks(request.params.id, request.authUser?.id));

  app.get('/v1/catalog/artists/:id/albums', {
    schema: {
      tags: ['Catalog'],
      summary: 'List albums for an artist',
      params: UuidParams,
      response: {
        200: Type.Array(FrontendAlbumSchema),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: catalogAuth,
  }, async (request) => app.catalogService.listArtistAlbums(request.params.id));
};

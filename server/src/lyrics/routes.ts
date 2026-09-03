import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema, TrackIdParams } from '../http/schemas.js';
import { LyricsResponseSchema, ResolveLyricsBodySchema } from './schemas.js';

export const lyricsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/tracks/:trackId/lyrics', {
    schema: {
      tags: ['Lyrics'],
      summary: 'Return cached lyrics only. Does not call a remote provider.',
      params: TrackIdParams,
      response: {
        200: LyricsResponseSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.lyricsService.getCached(request.authUser!.id, request.params.trackId));

  app.post('/v1/lyrics/resolve', {
    schema: {
      tags: ['Lyrics'],
      summary: 'Resolve lyrics from cache or the configured provider. Catalog metadata wins over the client body.',
      body: ResolveLyricsBodySchema,
      response: {
        200: LyricsResponseSchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        502: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.lyricsService.resolve(request.authUser!.id, request.body));
};

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema } from '../http/schemas.js';
import {
  HistoryHeadersSchema,
  HistoryQuerySchema,
  PlayHistoryEntrySchema,
  RecordHistoryBodySchema,
} from './schemas.js';

export const historyRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/history', {
    schema: {
      tags: ['History'],
      summary: 'List play history, newest first',
      querystring: HistoryQuerySchema,
      response: {
        200: Type.Array(PlayHistoryEntrySchema),
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.historyService.list(request.authUser!.id, request.query.limit, request.query.offset));

  app.post('/v1/history', {
    schema: {
      tags: ['History'],
      summary: 'Record a play. Retries with the same idempotency key return the original entry.',
      headers: HistoryHeadersSchema,
      body: RecordHistoryBodySchema,
      response: {
        200: PlayHistoryEntrySchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => {
    const header = request.headers['idempotency-key'];
    return app.historyService.record(
      request.authUser!.id,
      request.body,
      Array.isArray(header) ? header[0] : header,
    );
  });

  app.delete('/v1/history', {
    schema: {
      tags: ['History'],
      summary: 'Clear the current user play history',
      response: {
        200: Type.Integer(),
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.historyService.clear(request.authUser!.id));
};

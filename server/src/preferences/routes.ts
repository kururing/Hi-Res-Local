import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema } from '../http/schemas.js';

export const PreferencesViewSchema = Type.Object({
  schema_version: Type.Integer(),
  revision: Type.Integer(),
  preferences: Type.Record(Type.String(), Type.Unknown()),
  updated_at: Type.String({ format: 'date-time' }),
});

export const PutPreferencesBodySchema = Type.Object({
  revision: Type.Optional(Type.Integer({ minimum: 0 })),
  preferences: Type.Record(Type.String(), Type.Unknown()),
});

export const preferencesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/me/preferences', {
    schema: {
      tags: ['Users'],
      summary: 'Get portable account preferences',
      response: {
        200: PreferencesViewSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.preferencesService.get(request.authUser!.id));

  app.put('/v1/me/preferences', {
    schema: {
      tags: ['Users'],
      summary: 'Replace portable account preferences',
      body: PutPreferencesBodySchema,
      response: {
        200: PreferencesViewSchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.preferencesService.put(request.authUser!.id, {
      revision: request.body.revision,
      preferences: request.body.preferences,
    }));
};

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema } from '../http/schemas.js';
import { PatchMeBodySchema, UserViewSchema } from '../auth/schemas.js';

export const userRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/v1/me', {
    schema: {
      tags: ['Users'],
      summary: 'Get the authenticated profile',
      response: {
        200: UserViewSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.authService.me(request.authUser!.id));

  app.patch('/v1/me', {
    schema: {
      tags: ['Users'],
      summary: 'Update the authenticated profile',
      body: PatchMeBodySchema,
      response: {
        200: UserViewSchema,
        400: ErrorEnvelopeSchema,
        401: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) => app.authService.updateMe(request.authUser!.id, request.body.display_name));
};

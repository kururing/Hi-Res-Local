import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { pingDatabase } from '../db/pool.js';
import { ErrorCodes, errorEnvelope } from '../errors/appError.js';
import { withTimeout } from '../http/timeout.js';

const LiveSchema = Type.Object({ status: Type.Literal('live') });
const ReadySchema = Type.Object({
  status: Type.Literal('ready'),
  checks: Type.Object({
    database: Type.Literal('ok'),
    storage: Type.Literal('ok'),
  }),
});

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/health/live', {
    schema: {
      tags: ['Health'],
      summary: 'Process liveness',
      response: { 200: LiveSchema },
    },
  }, async () => ({ status: 'live' as const }));

  app.get('/health/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Database and storage readiness',
      response: {
        200: ReadySchema,
        503: Type.Object({
          code: Type.String(),
          message: Type.String(),
          request_id: Type.String(),
        }),
      },
    },
  }, async (request, reply) => {
    try {
      await withTimeout(
        pingDatabase(app.db),
        app.config.databasePingTimeoutMs,
        'Database readiness check timed out.',
      );
    } catch {
      return reply.status(503).send(
        errorEnvelope(ErrorCodes.NOT_READY, 'Database is not ready.', request.id),
      );
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), app.config.storagePingTimeoutMs);
      try {
        await app.storageSigner.ping(controller.signal);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return reply.status(503).send(
        errorEnvelope(ErrorCodes.NOT_READY, 'Object storage is not ready.', request.id),
      );
    }

    return {
      status: 'ready' as const,
      checks: { database: 'ok' as const, storage: 'ok' as const },
    };
  });
};

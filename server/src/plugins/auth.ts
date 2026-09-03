import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCodes, errorEnvelope } from '../errors/appError.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { defaultMetrics } from '../observability/metrics.js';

export function registerErrorHandler(app: {
  setErrorHandler: (handler: any) => unknown;
  setNotFoundHandler: (handler: any) => unknown;
}): void {
  app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      if (error.code.startsWith('AUTH_')) {
        (request.server.metrics ?? defaultMetrics).authFailure(error.code);
      }
      return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, requestId));
    }

    const err = error as { validation?: unknown; statusCode?: number; code?: string; message?: string };

    if (
      err.validation
      || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
      || err.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      return reply.status(400).send(
        errorEnvelope(ErrorCodes.VALIDATION_ERROR, 'Request validation failed.', requestId),
      );
    }

    if (err.statusCode === 429 || err.code === 'FST_ERR_RATE_LIMIT') {
      return reply.status(429).send(
        errorEnvelope(ErrorCodes.RATE_LIMITED, 'Too many requests.', requestId),
      );
    }

    request.log.error({ err: error }, 'unhandled_error');
    return reply.status(500).send(
      errorEnvelope(ErrorCodes.INTERNAL_ERROR, 'Internal server error.', requestId),
    );
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send(
      errorEnvelope(ErrorCodes.NOT_FOUND, 'Not found.', request.id),
    );
  });
}

export async function authenticateRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new AppError(401, ErrorCodes.AUTH_UNAUTHORIZED, 'Authentication required.');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError(401, ErrorCodes.AUTH_UNAUTHORIZED, 'Authentication required.');
  }
  const claims = await verifyAccessToken(request.server.config, token);
  await request.server.authService.assertActiveSession(claims.sid, claims.sub);
  request.authUser = { id: claims.sub, sessionId: claims.sid };
}

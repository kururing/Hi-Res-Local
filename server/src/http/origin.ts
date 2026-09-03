import type { FastifyRequest } from 'fastify';
import { AppError, ErrorCodes } from '../errors/appError.js';

export function assertAllowedOrigin(request: FastifyRequest, origins: string[]): void {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !origins.includes(origin)) {
    throw new AppError(
      403,
      ErrorCodes.AUTH_INVALID_ORIGIN,
      'Request origin is not allowed.',
    );
  }
}

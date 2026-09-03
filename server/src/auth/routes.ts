import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema } from '../http/schemas.js';
import { assertAllowedOrigin } from '../http/origin.js';
import { clearRefreshCookie, setRefreshCookie } from './cookies.js';
import { AuthSessionResponseSchema, LoginBodySchema, RegisterBodySchema } from './schemas.js';

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const cookieAuthLimit = {
    config: {
      rateLimit: {
        max: app.config.authRateLimitMax,
        timeWindow: app.config.authRateLimitWindowMs,
      },
    },
  };

  app.post('/v1/auth/register', {
    ...cookieAuthLimit,
    schema: {
      tags: ['Auth'],
      summary: 'Register a new account',
      body: RegisterBodySchema,
      response: {
        201: AuthSessionResponseSchema,
        400: ErrorEnvelopeSchema,
        403: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
        429: ErrorEnvelopeSchema,
      },
    },
  }, async (request, reply) => {
    assertAllowedOrigin(request, app.config.corsOrigins);
    const result = await app.authService.register(request.body, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });
    setRefreshCookie(reply, app.config, result.refreshToken);
    return reply.code(201).send({
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      user: result.user,
    });
  });

  app.post('/v1/auth/login', {
    ...cookieAuthLimit,
    schema: {
      tags: ['Auth'],
      summary: 'Sign in',
      body: LoginBodySchema,
      response: {
        200: AuthSessionResponseSchema,
        401: ErrorEnvelopeSchema,
        403: ErrorEnvelopeSchema,
        429: ErrorEnvelopeSchema,
      },
    },
  }, async (request, reply) => {
    assertAllowedOrigin(request, app.config.corsOrigins);
    const result = await app.authService.login(request.body, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });
    setRefreshCookie(reply, app.config, result.refreshToken);
    return reply.code(200).send({
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      user: result.user,
    });
  });

  app.post('/v1/auth/refresh', {
    ...cookieAuthLimit,
    schema: {
      tags: ['Auth'],
      summary: 'Rotate the refresh token and issue a new access token',
      response: {
        200: AuthSessionResponseSchema,
        401: ErrorEnvelopeSchema,
        403: ErrorEnvelopeSchema,
        429: ErrorEnvelopeSchema,
      },
    },
  }, async (request, reply) => {
    assertAllowedOrigin(request, app.config.corsOrigins);
    const result = await app.authService.refresh(request.cookies[app.config.cookieName], {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });
    setRefreshCookie(reply, app.config, result.refreshToken);
    return reply.code(200).send({
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      user: result.user,
    });
  });

  app.post('/v1/auth/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Revoke the current refresh session',
      response: {
        204: Type.Null(),
        403: ErrorEnvelopeSchema,
      },
    },
  }, async (request, reply) => {
    assertAllowedOrigin(request, app.config.corsOrigins);
    await app.authService.logout(request.cookies[app.config.cookieName]);
    clearRefreshCookie(reply, app.config);
    return reply.code(204).send(null);
  });
};

import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config/env.js';

export function setRefreshCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: config.cookiePath,
    maxAge: config.refreshTokenTtlSeconds,
    domain: config.cookieDomain,
  });
}

export function clearRefreshCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: config.cookiePath,
    domain: config.cookieDomain,
  });
}

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { AppConfig } from '../config/env.js';
import { AppError, ErrorCodes } from '../errors/appError.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

function secretKey(config: AppConfig): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export async function signAccessToken(
  config: AppConfig,
  userId: string,
  sessionId: string,
): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(secretKey(config));

  return { token, expiresIn: config.accessTokenTtlSeconds };
}

export async function verifyAccessToken(
  config: AppConfig,
  token: string,
): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config), {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithms: ['HS256'],
    });
    const sub = payload.sub;
    const sid = payload.sid;
    if (!sub || typeof sid !== 'string') {
      throw new AppError(401, ErrorCodes.AUTH_TOKEN_INVALID, 'Invalid access token.');
    }
    return {
      sub,
      sid,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
      iss: payload.iss ?? config.jwtIssuer,
      aud: typeof payload.aud === 'string' ? payload.aud : config.jwtAudience,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof joseErrors.JWTExpired) {
      throw new AppError(401, ErrorCodes.AUTH_TOKEN_EXPIRED, 'Access token expired.');
    }
    throw new AppError(401, ErrorCodes.AUTH_TOKEN_INVALID, 'Invalid access token.');
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

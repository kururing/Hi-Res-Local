import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { testConfig } from '../../src/config/env.js';
import { generateRefreshToken, hashRefreshToken, normalizeEmail, signAccessToken, verifyAccessToken } from '../../src/auth/tokens.js';
import { AppError } from '../../src/errors/appError.js';

describe('auth token helpers', () => {
  it('normalizes email by trim and lowercase', () => {
    expect(normalizeEmail('  Bang@Example.COM ')).toBe('bang@example.com');
  });

  it('hashes refresh tokens with SHA-256 and keeps high entropy', () => {
    const token = generateRefreshToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(hashRefreshToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRefreshToken(token)).not.toBe(token);
  });

  it('signs and verifies access tokens with issuer and audience', async () => {
    const config = testConfig();
    const signed = await signAccessToken(config, 'user-1', 'session-1');
    const claims = await verifyAccessToken(config, signed.token);
    expect(claims.sub).toBe('user-1');
    expect(claims.sid).toBe('session-1');
    expect(claims.iss).toBe(config.jwtIssuer);
    expect(claims.aud).toBe(config.jwtAudience);
    expect(JSON.stringify(claims)).not.toContain('password');
    expect(JSON.stringify(claims)).not.toContain('@');
  });

  it('rejects invalid and expired access tokens', async () => {
    const config = testConfig();
    await expect(verifyAccessToken(config, 'not-a-jwt')).rejects.toBeInstanceOf(AppError);
    await expect(verifyAccessToken(config, 'not-a-jwt')).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });

    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ sid: 'session-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer(config.jwtIssuer)
      .setAudience(config.jwtAudience)
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode(config.jwtSecret));

    await expect(verifyAccessToken(config, expired)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
    });
  });
});

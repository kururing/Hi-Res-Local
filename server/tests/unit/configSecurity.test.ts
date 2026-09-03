import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

describe('production security configuration', () => {
  it('rejects the public fallback JWT secret', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
    })).toThrow('JWT_SECRET must be explicitly configured for production');
  });

  it('requires an explicit secure-cookie decision', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-with-32-characters',
    })).toThrow('COOKIE_SECURE must be explicitly configured for production');
  });

  it('accepts explicit production secrets and secure cookies', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-with-32-characters',
      COOKIE_SECURE: 'true',
      DATABASE_URL: 'postgres://prod:prod@db.internal:5432/nghenhac',
      S3_ACCESS_KEY: 'prod-access-key',
      S3_SECRET_KEY: 'prod-secret-key',
    });
    expect(config.cookieSecure).toBe(true);
    expect(config.s3.accessKeyId).toBe('prod-access-key');
  });

  it('rejects local MinIO credential defaults in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-with-32-characters',
      COOKIE_SECURE: 'true',
      S3_ACCESS_KEY: 'minioadmin',
      S3_SECRET_KEY: 'minioadmin',
    })).toThrow('S3 credentials must not use the local MinIO defaults');
  });

  it('requires an explicit DATABASE_URL in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-with-32-characters',
      COOKIE_SECURE: 'true',
      S3_ACCESS_KEY: 'prod-access-key',
      S3_SECRET_KEY: 'prod-secret-key',
    })).toThrow('DATABASE_URL must be explicitly configured for production');
  });
});

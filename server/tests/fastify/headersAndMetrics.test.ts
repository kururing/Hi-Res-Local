import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../../src/config/env.js';
import { FakeObjectStorageSigner } from '../../src/storage/fakeSigner.js';

function throwingPool(): Pool {
  const fail = () => {
    throw new Error('Fake Fastify tests must not query PostgreSQL');
  };
  return { query: fail, connect: fail, end: async () => undefined } as unknown as Pool;
}

const app = await buildApp({
  config: testConfig({ metricsEnabled: true, metricsToken: 'metrics-test-token' }),
  pool: throwingPool(),
  signer: new FakeObjectStorageSigner(),
  logger: false,
});
await app.ready();

describe('Fastify cache, CSP, and metrics', () => {
  afterAll(async () => {
    await app.close();
  });

  it('sets no-store and security headers on auth responses', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      payload: { email: 'nobody@example.test', password: 'incorrect1' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(String(response.headers['content-security-policy'])).not.toMatch(/\*/);
  });

  it('hides metrics without a token and omits high-cardinality labels', async () => {
    const denied = await app.inject({ method: 'GET', url: '/metrics' });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer metrics-test-token' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['cache-control']).toBe('no-store');
    expect(allowed.body).not.toMatch(/access_token|@example|X-Amz-Signature/);
  });
});

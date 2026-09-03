import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../../src/config/env.js';
import { FakeObjectStorageSigner } from '../../src/storage/fakeSigner.js';

function failingPool(): Pool {
  return {
    query: async () => {
      throw new Error('database unavailable');
    },
    connect: async () => {
      throw new Error('database unavailable');
    },
    end: async () => undefined,
  } as unknown as Pool;
}

const app = await buildApp({
  config: testConfig({ databasePingTimeoutMs: 200 }),
  pool: failingPool(),
  signer: new FakeObjectStorageSigner(),
  logger: false,
});
await app.ready();

describe('readiness', () => {
  afterAll(async () => {
    await app.close();
  });

  it('fails ready when the database is unavailable without hanging', async () => {
    const started = Date.now();
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('NOT_READY');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

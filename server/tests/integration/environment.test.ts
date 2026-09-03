import { describe, expect, it } from 'vitest';
import { integrationTestsRequired } from './flags.js';
import { getIntegration } from './helpers.js';

describe('integration environment', () => {
  it('connects to PostgreSQL when integration is required and reports skip otherwise', async () => {
    const ctx = await getIntegration();
    if (!ctx.ready) {
      expect(integrationTestsRequired()).toBe(false);
      console.warn(`[integration] skipped remaining database tests: ${ctx.reason}`);
      return;
    }
    expect(ctx.app).toBeDefined();
    const live = await ctx.app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.headers['cache-control']).toBe('no-store');
  });
});

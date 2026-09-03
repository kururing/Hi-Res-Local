import { describe, expect, it } from 'vitest';
import { cacheControlForPath } from '../../src/http/cacheControl.js';
import { apiContentSecurityPolicy, cspAllowsWildcard } from '../../src/http/securityHeaders.js';
import { testConfig } from '../../src/config/env.js';

describe('cache and security headers', () => {
  it('uses no-store for auth, me, admin, and signed stream descriptors', () => {
    const opts = { catalogPublic: false, authenticated: true };
    expect(cacheControlForPath('POST', '/v1/auth/login', opts)).toBe('no-store');
    expect(cacheControlForPath('GET', '/v1/me', opts)).toBe('no-store');
    expect(cacheControlForPath('POST', '/v1/admin/catalog/tracks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/audio-uploads', opts)).toBe('no-store');
    expect(cacheControlForPath('POST', '/v1/tracks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/stream', opts)).toBe('no-store');
    expect(cacheControlForPath('POST', '/v1/tracks/:trackId/stream', opts)).toBe('no-store');
  });

  it('does not share-cache authenticated library or catalog responses', () => {
    expect(cacheControlForPath('GET', '/v1/library/tracks', { catalogPublic: true, authenticated: true })).toBe('private, no-store');
    expect(cacheControlForPath('GET', '/v1/playlists', { catalogPublic: true, authenticated: true })).toBe('private, no-store');
    expect(cacheControlForPath('GET', '/v1/catalog/search', { catalogPublic: false, authenticated: true })).toBe('private, no-store');
    expect(cacheControlForPath('GET', '/v1/catalog/search', { catalogPublic: true, authenticated: false })).toBe('public, max-age=30, must-revalidate');
  });

  it('builds a CSP that allows required origins without wildcards', () => {
    const policy = apiContentSecurityPolicy(testConfig({
      publicMediaBaseUrl: 'http://127.0.0.1:9000/nghenhacpromax-artwork',
      s3: {
        ...testConfig().s3,
        publicEndpoint: 'http://127.0.0.1:9000',
      },
    }));
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:9000");
    expect(policy).toContain('img-src');
    expect(policy).toContain('media-src');
    expect(cspAllowsWildcard(policy)).toBe(false);
  });
});

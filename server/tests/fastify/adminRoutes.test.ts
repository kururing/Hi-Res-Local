import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../../src/config/env.js';
import { AppError, ErrorCodes } from '../../src/errors/appError.js';
import type { AdminCatalogService } from '../../src/admin/catalogService.js';
import type { AdminUploadService } from '../../src/admin/uploadService.js';
import type { RolesService } from '../../src/rbac/service.js';
import { FakeObjectStorageSigner } from '../../src/storage/fakeSigner.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TRACK = '33333333-3333-4333-8333-333333333331';

function throwingPool(): Pool {
  const fail = () => {
    throw new Error('Fake Fastify tests must not query PostgreSQL');
  };
  return { query: fail, connect: fail, end: async () => undefined } as unknown as Pool;
}

const rolesService = {
  hasCatalogAdmin: async (userId: string) => userId === USER,
  capabilities: async (userId: string) => ({ catalog_admin: userId === USER, admin: false }),
} as unknown as RolesService;

const adminCatalogService = {
  listArtists: async () => [{ id: USER, name: 'Aurora', image_url: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
  createArtist: async () => ({ id: USER, name: 'Aurora', image_url: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }),
  listTracks: async () => [],
  getTrack: async () => ({ id: TRACK, title: 'Lanterns', publish_blockers: ['audio_asset_not_ready'] }),
  lookupArtistArtwork: async () => ({
    id: USER,
    entity_type: 'artist',
    url: 'https://is1-ssl.mzstatic.com/image/thumb/Features/a.jpg',
    found: true,
  }),
  lookupAlbumArtwork: async () => ({ id: TRACK, entity_type: 'album', url: null, found: false }),
  lookupMissingArtwork: async () => ({ looked_up: 0, filled: 0, skipped: 0, artists: [], albums: [] }),
} as unknown as AdminCatalogService;

const adminUploadService = {
  initAudio: async () => ({
    upload_id: TRACK,
    method: 'PUT',
    url: 'https://storage.test/put',
    headers: { 'content-type': 'audio/flac' },
    expires_at: '2026-01-01T00:00:00.000Z',
    object_key: null,
  }),
} as unknown as AdminUploadService;

const adminApp = await buildApp({
  config: testConfig(),
  pool: throwingPool(),
  signer: new FakeObjectStorageSigner(),
  logger: false,
  rolesService,
  adminCatalogService,
  adminUploadService,
  authenticate: async (request) => {
    request.authUser = { id: USER, sessionId: 'sess' };
  },
});
await adminApp.ready();

const forbiddenApp = await buildApp({
  config: testConfig(),
  pool: throwingPool(),
  signer: new FakeObjectStorageSigner(),
  logger: false,
  rolesService: {
    hasCatalogAdmin: async () => false,
    capabilities: async () => ({ catalog_admin: false, admin: false }),
  } as unknown as RolesService,
  adminCatalogService,
  authenticate: async (request) => {
    request.authUser = { id: USER, sessionId: 'sess' };
  },
});
await forbiddenApp.ready();

describe('Fastify admin routes with fake services', () => {
  afterAll(async () => {
    await adminApp.close();
    await forbiddenApp.close();
  });

  it('returns capabilities without treating UI as the security boundary', async () => {
    const allowed = await adminApp.inject({ url: '/v1/admin/capabilities' });
    expect(allowed.json()).toEqual({ catalog_admin: true, admin: false });
    const denied = await forbiddenApp.inject({ url: '/v1/admin/capabilities' });
    expect(denied.json()).toEqual({ catalog_admin: false, admin: false });
  });

  it('returns 403 ADMIN_FORBIDDEN when the role is missing', async () => {
    const response = await forbiddenApp.inject({ url: '/v1/admin/catalog/artists' });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(ErrorCodes.ADMIN_FORBIDDEN);
  });

  it('presigns audio without returning an object key', async () => {
    const response = await adminApp.inject({
      method: 'POST',
      url: `/v1/admin/catalog/tracks/${TRACK}/audio-uploads`,
      payload: {
        filename: 'track.flac',
        content_type: 'audio/flac',
        size_bytes: 1000,
        checksum_sha256: 'a'.repeat(64),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().object_key).toBeNull();
    expect(response.json().url).toContain('https://storage.test/put');
  });

  it('exposes admin paths in OpenAPI', async () => {
    const spec = await adminApp.inject({ url: '/docs/openapi.json' });
    const paths = spec.json().paths;
    expect(paths['/v1/admin/capabilities']).toBeTruthy();
    expect(paths['/v1/admin/catalog/tracks']).toBeTruthy();
    expect(paths['/v1/admin/imports']).toBeTruthy();
    expect(paths['/v1/admin/imports/{id}/commit']).toBeTruthy();
    expect(paths['/v1/admin/catalog/artwork-lookup']).toBeTruthy();
    expect(paths['/v1/admin/catalog/artists/{id}/artwork-lookup']).toBeTruthy();
  });

  it('stores a remote artwork URL without requiring a file upload', async () => {
    const response = await adminApp.inject({
      method: 'POST',
      url: `/v1/admin/catalog/artists/${USER}/artwork-lookup`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: USER,
      entity_type: 'artist',
      found: true,
    });
  });

  it('rejects artwork lookup when the catalog admin role is missing', async () => {
    const response = await forbiddenApp.inject({
      method: 'POST',
      url: '/v1/admin/catalog/artwork-lookup',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe(ErrorCodes.ADMIN_FORBIDDEN);
  });
});

void AppError;

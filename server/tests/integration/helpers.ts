import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { describe, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testConfig, type AppConfig } from '../../src/config/env.js';
import { migrate } from '../../src/db/migrator.js';
import { createPool } from '../../src/db/pool.js';
import { FakeLyricsProvider } from '../../src/lyrics/fakeProvider.js';
import { CATALOG_ADMIN_ROLE } from '../../src/rbac/roles.js';
import { RolesRepository } from '../../src/rbac/repository.js';
import { FakeObjectStorageSigner } from '../../src/storage/fakeSigner.js';
import { integrationTestsRequired, markSuiteRan, setGate } from './flags.js';
import {
  assertSafeDatabaseName,
  parseDatabaseUrl,
  toIntegrationDatabaseUrl,
} from './databaseUrl.js';

export const ORIGIN = 'http://localhost:5173';

export const APP_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://nghenhac:nghenhac@127.0.0.1:5433/nghenhac';

/** Isolated from the app catalog. Override with INTEGRATION_DATABASE_URL. */
export const DEFAULT_DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ?? toIntegrationDatabaseUrl(APP_DATABASE_URL);

/** Marks the integration-only catalog fixture. Never used by production ingest. */
export const CATALOG_FIXTURE_COVER_URL = 'https://cdn.example.test/covers/glass-harbor.jpg';

export interface CatalogFixture {
  artistId: string;
  albumId: string;
  trackId: string;
  unavailableTrackId: string;
  lossyOnlyTrackId: string;
  hiResKey: string;
  cdKey: string;
  mp3Key: string;
}

export interface IntegrationContext {
  ready: true;
  pool: Pool;
  config: AppConfig;
  signer: FakeObjectStorageSigner;
  lyricsProvider: FakeLyricsProvider;
  app: FastifyInstance;
  fixture: CatalogFixture;
}

export interface IntegrationUnavailable {
  ready: false;
  reason: string;
}

export type IntegrationHandle = IntegrationContext | IntegrationUnavailable;

let cached: Promise<IntegrationHandle> | undefined;
let warned = false;

export function integrationUnavailableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `PostgreSQL is not reachable at ${DEFAULT_DATABASE_URL} (${message}). Start it with npm run infra:up, then re-run npm run server:test.`;
}

async function resetData(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE
      admin_audit_log,
      ingestion_jobs,
      artwork_assets,
      audio_imports,
      media_uploads,
      track_rights,
      user_roles,
      user_preferences,
      track_lyrics,
      play_history,
      user_favorite_tracks,
      user_favorite_albums,
      user_favorite_artists,
      playlist_tracks,
      playlists,
      library_changes,
      user_library_tracks,
      audio_assets,
      track_artists,
      tracks,
      albums,
      artists,
      refresh_sessions,
      user_profiles,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function insertCatalog(pool: Pool): Promise<CatalogFixture> {
  const artistId = randomUUID();
  const albumId = randomUUID();
  const trackId = randomUUID();
  const unavailableTrackId = randomUUID();
  const lossyOnlyTrackId = randomUUID();
  const hiResKey = `catalog/${trackId}/flac-24-96.flac`;
  const cdKey = `catalog/${trackId}/flac-16-44.flac`;
  const mp3Key = `catalog/${trackId}/mp3-320.mp3`;

  await pool.query(
    `INSERT INTO artists (id, name, sort_name) VALUES ($1, 'Aurora Circuit', 'aurora circuit')`,
    [artistId],
  );
  await pool.query(
    `INSERT INTO albums (id, title, primary_artist_id, year, genre, cover_art_url)
     VALUES ($1, 'Glass Harbor', $2, 2024, 'Electronic', $3)`,
    [albumId, artistId, CATALOG_FIXTURE_COVER_URL],
  );
  await pool.query(
    `INSERT INTO tracks (id, title, album_id, track_number, disc_number, duration_seconds, genre, available)
     VALUES
       ($1, 'Lanterns Over Water', $4, 1, 1, 214.5, 'Electronic', TRUE),
       ($2, 'Withdrawn Signal', $4, 2, 1, 180.0, 'Electronic', FALSE),
       ($3, 'Paper Wing', $4, 3, 1, 200.0, 'Electronic', TRUE)`,
    [trackId, unavailableTrackId, lossyOnlyTrackId, albumId],
  );
  await pool.query(
    `INSERT INTO track_artists (track_id, artist_id, role, position) VALUES
       ($1, $4, 'primary', 0),
       ($2, $4, 'primary', 0),
       ($3, $4, 'primary', 0)`,
    [trackId, unavailableTrackId, lossyOnlyTrackId, artistId],
  );

  const assets = [
    [randomUUID(), trackId, hiResKey, 'flac', 'flac', 96_000, 24, 2, 3200, 214.5, 48_000_000, 'sha256:hi', true, true],
    [randomUUID(), trackId, cdKey, 'flac', 'flac', 44_100, 16, 2, 900, 214.5, 22_000_000, 'sha256:cd', true, true],
    [randomUUID(), trackId, mp3Key, 'mp3', 'mp3', 44_100, null, 2, 320, 214.5, 8_580_000, 'sha256:mp3', false, true],
    [randomUUID(), lossyOnlyTrackId, `catalog/${lossyOnlyTrackId}/mp3-320.mp3`, 'mp3', 'mp3', 44_100, null, 2, 320, 200, 8_000_000, 'sha256:lossy', false, true],
    [randomUUID(), unavailableTrackId, `catalog/${unavailableTrackId}/flac.flac`, 'flac', 'flac', 44_100, 16, 2, 800, 180, 18_000_000, 'sha256:unavail', true, false],
  ];

  for (const asset of assets) {
    await pool.query(
      `INSERT INTO audio_assets (
         id, track_id, storage_key, container, codec, sample_rate_hz, bit_depth, channels,
         bitrate_kbps, duration_seconds, file_size_bytes, checksum, is_lossless, available
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      asset,
    );
  }

  return { artistId, albumId, trackId, unavailableTrackId, lossyOnlyTrackId, hiResKey, cdKey, mp3Key };
}

/** Removes the integration catalog fixture without touching imported catalog rows. */
export async function removeCatalogFixture(pool: Pool): Promise<{ tracks: number; albums: number; artists: number }> {
  const tracks = await pool.query(
    `DELETE FROM tracks
     WHERE title IN ('Lanterns Over Water', 'Withdrawn Signal', 'Paper Wing')
       AND (
         album_id IN (
           SELECT id FROM albums
           WHERE cover_art_url = $1 OR title = 'Glass Harbor'
         )
         OR EXISTS (
           SELECT 1
           FROM track_artists ta
           JOIN artists a ON a.id = ta.artist_id
           WHERE ta.track_id = tracks.id AND a.name = 'Aurora Circuit'
         )
       )`,
    [CATALOG_FIXTURE_COVER_URL],
  );
  const albums = await pool.query(
    `DELETE FROM albums
     WHERE (cover_art_url = $1 OR title = 'Glass Harbor')
       AND (
         cover_art_url = $1
         OR primary_artist_id IN (SELECT id FROM artists WHERE name = 'Aurora Circuit')
       )
       AND NOT EXISTS (SELECT 1 FROM tracks WHERE album_id = albums.id)`,
    [CATALOG_FIXTURE_COVER_URL],
  );
  const artists = await pool.query(
    `DELETE FROM artists
     WHERE name = 'Aurora Circuit'
       AND sort_name = 'aurora circuit'
       AND placeholder_kind IS NULL
       AND NOT EXISTS (SELECT 1 FROM track_artists WHERE artist_id = artists.id)
       AND NOT EXISTS (SELECT 1 FROM albums WHERE primary_artist_id = artists.id)`,
  );
  return {
    tracks: tracks.rowCount ?? 0,
    albums: albums.rowCount ?? 0,
    artists: artists.rowCount ?? 0,
  };
}

async function ensureIntegrationDatabase(targetUrl: string, adminUrl: string): Promise<void> {
  const target = parseDatabaseUrl(targetUrl);
  const admin = parseDatabaseUrl(adminUrl);
  if (target.name === admin.name) return;
  assertSafeDatabaseName(target.name);
  const pool = createPool(adminUrl, 2_000);
  try {
    const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.name]);
    if ((found.rowCount ?? 0) > 0) return;
    await pool.query(`CREATE DATABASE ${target.name}`);
  } finally {
    await pool.end();
  }
}

async function buildContext(): Promise<IntegrationHandle> {
  const config = testConfig({ databaseUrl: DEFAULT_DATABASE_URL });
  const pool = createPool(config.databaseUrl, 2_000);
  try {
    await ensureIntegrationDatabase(DEFAULT_DATABASE_URL, APP_DATABASE_URL);
    await pool.query('SELECT 1');
    await migrate(pool);
    await resetData(pool);
    const fixture = await insertCatalog(pool);
    const signer = new FakeObjectStorageSigner();
    const lyricsProvider = new FakeLyricsProvider();
    const app = await buildApp({ config, pool, signer, lyricsProvider, logger: false });
    await app.ready();
    setGate('postgres', 'PASS');
    return { ready: true, pool, config, signer, lyricsProvider, app, fixture };
  } catch (error) {
    await pool.end().catch(() => undefined);
    const reason = integrationUnavailableReason(error);
    if (integrationTestsRequired()) {
      setGate('postgres', 'FAIL');
      throw new Error(reason);
    }
    setGate('postgres', 'SKIP');
    if (!warned) {
      warned = true;
      console.warn(`\n[integration] ${reason}\n`);
    }
    return { ready: false, reason };
  }
}

export function getIntegration(): Promise<IntegrationHandle> {
  cached ??= buildContext();
  return cached;
}

export async function resetIntegration(): Promise<CatalogFixture> {
  const ctx = await getIntegration();
  if (!ctx.ready) throw new Error(ctx.reason);
  await resetData(ctx.pool);
  ctx.signer.clear();
  ctx.signer.calls.length = 0;
  ctx.lyricsProvider.reset();
  ctx.fixture = await insertCatalog(ctx.pool);
  return ctx.fixture;
}

export async function closeIntegration(): Promise<void> {
  if (!cached) return;
  const ctx = await cached;
  if (ctx.ready) {
    await removeCatalogFixture(ctx.pool).catch(() => undefined);
    await ctx.app.close();
    await ctx.pool.end();
  }
  cached = undefined;
}

export function cookieHeader(name: string, value: string): string {
  return `${name}=${value}`;
}

export async function grantCatalogAdmin(pool: Pool, userId: string): Promise<void> {
  await new RolesRepository(pool).grant(userId, CATALOG_ADMIN_ROLE, null);
}

export function refreshFrom(response: { cookies: Array<{ name: string; value: string }> }, cookieName: string): string {
  const cookie = response.cookies.find((entry) => entry.name === cookieName);
  if (!cookie) throw new Error('Refresh cookie was not set.');
  return cookie.value;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

export function describeIntegration(
  name: string,
  handle: IntegrationHandle,
  fn: (ctx: IntegrationContext) => void,
): void {
  if (!handle.ready) {
    if (integrationTestsRequired()) {
      describe(name, () => {
        it('requires PostgreSQL', () => {
          throw new Error(handle.reason);
        });
      });
      return;
    }
    describe.skip(`${name} (PostgreSQL unavailable)`, () => {
      it('starts infra with npm run infra:up', () => {
        // Intentionally skipped. See the [integration] warning for the connection error.
      });
    });
    return;
  }
  markSuiteRan(name);
  describe(name, () => fn(handle));
}

import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: path.resolve(process.cwd(), '.env') });

export type CookieSameSite = 'lax' | 'strict' | 'none';

export type MediaProbeMode = 'nnpm' | 'fake';

export type StorageCompatibility = 'aws' | 'minio';

export interface S3Config {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  artworkBucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  compatibility: StorageCompatibility;
}

export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: string;
  logLevel: string;
  databaseUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  cookieName: string;
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  cookieDomain: string | undefined;
  cookiePath: string;
  corsOrigins: string[];
  catalogPublic: boolean;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  trustedProxyHops: number;
  s3: S3Config;
  signedUrlTtlSeconds: number;
  storagePingTimeoutMs: number;
  publicMediaBaseUrl: string;
  uploadMaxAudioBytes: number;
  uploadMaxArtworkBytes: number;
  presignPutTtlSeconds: number;
  nnpmProbePath: string;
  nnpmProbeStartupTimeoutMs: number;
  mediaProbeMode: MediaProbeMode;
  workerPollMs: number;
  workerLeaseSeconds: number;
  workerOnceBatchSize: number;
  workerTempDir: string;
  workerHeartbeatPath: string;
  metricsEnabled: boolean;
  metricsToken: string | undefined;
  databasePingTimeoutMs: number;
  allowedAudioMimes: string[];
  allowedArtworkMimes: string[];
  artworkMaxPixels: number;
  artworkRequiredForPublish: boolean;
  lyricsProviderUrl: string;
  lyricsProviderTimeoutMs: number;
  lyricsProviderMaxBytes: number;
  lyricsPositiveTtlSeconds: number;
  lyricsNegativeTtlSeconds: number;
  importReconcilePrefixes: string[];
  importReconcileMaxObjects: number;
  streamRateLimitMax: number;
  adminRateLimitMax: number;
  docsEnabled: boolean;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value == null || value === '' ? undefined : value;
}

function required(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = read(env, name) ?? fallback;
  if (value == null) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = read(env, name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }
  return Math.trunc(value);
}

function csv(env: NodeJS.ProcessEnv, name: string, fallback: string): string[] {
  return (read(env, name) ?? fallback)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function csvKeepCase(env: NodeJS.ProcessEnv, name: string, fallback: string): string[] {
  return (read(env, name) ?? fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = read(env, name);
  if (raw == null) return fallback;
  return raw === 'true' || raw === '1';
}

export function resolveStorageCompatibility(
  raw: string | undefined,
  endpoint: string,
): StorageCompatibility {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'aws' || value === 's3') return 'aws';
  if (value === 'minio') return 'minio';
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    if (host === 'amazonaws.com' || host.endsWith('.amazonaws.com') || host.endsWith('.amazonaws.com.cn')) {
      return 'aws';
    }
  } catch {
    // Keep the local/MinIO default when the endpoint is not a URL.
  }
  return 'minio';
}

function mediaProbeMode(env: NodeJS.ProcessEnv): MediaProbeMode {
  const raw = (read(env, 'MEDIA_PROBE_MODE') ?? 'nnpm').toLowerCase();
  if (raw === 'nnpm' || raw === 'fake') return raw;
  throw new Error('MEDIA_PROBE_MODE must be nnpm or fake.');
}

function sameSite(env: NodeJS.ProcessEnv, name: string, fallback: CookieSameSite): CookieSameSite {
  const raw = (read(env, name) ?? fallback).toLowerCase();
  if (raw === 'lax' || raw === 'strict' || raw === 'none') return raw;
  throw new Error(`${name} must be lax, strict, or none.`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = read(env, 'NODE_ENV') ?? 'development';
  const defaultJwtSecret = 'replace-with-at-least-32-chars-secret';
  const configuredJwtSecret = read(env, 'JWT_SECRET');
  const jwtSecret = configuredJwtSecret ?? defaultJwtSecret;
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters.');
  }
  if (nodeEnv === 'production' && (!configuredJwtSecret || jwtSecret === defaultJwtSecret)) {
    throw new Error('JWT_SECRET must be explicitly configured for production.');
  }

  const corsOrigins = required(
    env,
    'CORS_ORIGINS',
    'http://localhost:1420,http://127.0.0.1:1420,http://localhost:5173,http://127.0.0.1:5173',
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin.');
  }
  if (corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGINS cannot include a wildcard when cookies are used.');
  }

  const cookieSameSite = sameSite(env, 'COOKIE_SAMESITE', 'lax');
  if (nodeEnv === 'production' && read(env, 'COOKIE_SECURE') == null) {
    throw new Error('COOKIE_SECURE must be explicitly configured for production.');
  }
  const cookieSecure = bool(env, 'COOKIE_SECURE', false);
  if (cookieSameSite === 'none' && !cookieSecure) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true.');
  }

  const cookieDomain = read(env, 'COOKIE_DOMAIN');

  const s3AccessKeyId = read(env, 'S3_ACCESS_KEY') ?? (nodeEnv === 'production' ? undefined : 'minioadmin');
  const s3SecretAccessKey = read(env, 'S3_SECRET_KEY') ?? (nodeEnv === 'production' ? undefined : 'minioadmin');
  if (!s3AccessKeyId || !s3SecretAccessKey) {
    throw new Error('S3_ACCESS_KEY and S3_SECRET_KEY must be explicitly configured for production.');
  }
  if (
    nodeEnv === 'production'
    && (s3AccessKeyId === 'minioadmin' || s3SecretAccessKey === 'minioadmin')
  ) {
    throw new Error('S3 credentials must not use the local MinIO defaults in production.');
  }
  if (nodeEnv === 'production' && !read(env, 'DATABASE_URL')) {
    throw new Error('DATABASE_URL must be explicitly configured for production.');
  }

  return {
    host: read(env, 'HOST') ?? '127.0.0.1',
    port: integer(env, 'PORT', 3001, 1, 65535),
    nodeEnv,
    logLevel: read(env, 'LOG_LEVEL') ?? 'info',
    databaseUrl: required(
      env,
      'DATABASE_URL',
      'postgres://nghenhac:nghenhac@127.0.0.1:5433/nghenhac',
    ),
    jwtIssuer: required(env, 'JWT_ISSUER', 'https://nghenhacpromax.local'),
    jwtAudience: required(env, 'JWT_AUDIENCE', 'nghenhacpromax-web'),
    jwtSecret,
    accessTokenTtlSeconds: integer(env, 'ACCESS_TOKEN_TTL_SECONDS', 900, 1, 3600),
    refreshTokenTtlSeconds: integer(env, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000, 60, 31_536_000),
    cookieName: read(env, 'COOKIE_NAME') ?? 'nnpm_refresh',
    cookieSecure,
    cookieSameSite,
    cookieDomain,
    cookiePath: read(env, 'COOKIE_PATH') ?? '/v1/auth',
    corsOrigins,
    catalogPublic: bool(env, 'CATALOG_PUBLIC', false),
    authRateLimitMax: integer(env, 'AUTH_RATE_LIMIT_MAX', 10, 1, 10_000),
    authRateLimitWindowMs: integer(env, 'AUTH_RATE_LIMIT_WINDOW_MS', 60_000, 1000, 3_600_000),
    trustedProxyHops: integer(env, 'TRUST_PROXY_HOPS', 0, 0, 8),
    s3: {
      endpoint: required(env, 'S3_ENDPOINT', 'http://127.0.0.1:9000'),
      publicEndpoint: required(env, 'S3_PUBLIC_ENDPOINT', read(env, 'S3_ENDPOINT') ?? 'http://127.0.0.1:9000'),
      region: read(env, 'S3_REGION') ?? 'us-east-1',
      bucket: required(env, 'S3_BUCKET', 'nghenhacpromax'),
      artworkBucket: required(env, 'S3_ARTWORK_BUCKET', 'nghenhacpromax-artwork'),
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      forcePathStyle: bool(env, 'S3_FORCE_PATH_STYLE', true),
      compatibility: resolveStorageCompatibility(
        read(env, 'S3_COMPATIBILITY'),
        required(env, 'S3_ENDPOINT', 'http://127.0.0.1:9000'),
      ),
    },
    signedUrlTtlSeconds: integer(env, 'SIGNED_URL_TTL_SECONDS', 180, 60, 300),
    storagePingTimeoutMs: integer(env, 'STORAGE_PING_TIMEOUT_MS', 2000, 200, 10_000),
    publicMediaBaseUrl: required(env, 'PUBLIC_MEDIA_BASE_URL', 'http://127.0.0.1:9000/nghenhacpromax-artwork'),
    uploadMaxAudioBytes: integer(env, 'UPLOAD_MAX_AUDIO_BYTES', 1_073_741_824, 1024, 2_147_483_647),
    uploadMaxArtworkBytes: integer(env, 'UPLOAD_MAX_ARTWORK_BYTES', 20_000_000, 1024, 100_000_000),
    presignPutTtlSeconds: integer(env, 'PRESIGN_PUT_TTL_SECONDS', 900, 60, 1800),
    nnpmProbePath: read(env, 'NNPM_PROBE_PATH') ?? 'nnpm-probe',
    nnpmProbeStartupTimeoutMs: integer(env, 'NNPM_PROBE_STARTUP_TIMEOUT_MS', 5_000, 500, 30_000),
    mediaProbeMode: mediaProbeMode(env),
    workerPollMs: integer(env, 'WORKER_POLL_MS', 1500, 200, 60_000),
    workerLeaseSeconds: integer(env, 'WORKER_LEASE_SECONDS', 120, 15, 3600),
    workerOnceBatchSize: integer(env, 'WORKER_ONCE_BATCH_SIZE', 8, 1, 100),
    workerTempDir: read(env, 'WORKER_TEMP_DIR') ?? '',
    workerHeartbeatPath: read(env, 'WORKER_HEARTBEAT_PATH') ?? '',
    metricsEnabled: bool(env, 'METRICS_ENABLED', false),
    metricsToken: read(env, 'METRICS_TOKEN'),
    databasePingTimeoutMs: integer(env, 'DATABASE_PING_TIMEOUT_MS', 2_000, 200, 10_000),
    allowedAudioMimes: csv(
      env,
      'ALLOWED_AUDIO_MIMES',
      'audio/flac,audio/x-flac,audio/wav,audio/wave,audio/x-wav,audio/aiff,audio/x-aiff,audio/mpeg,audio/mp3,audio/mp4,audio/aac,audio/x-m4a,audio/ogg,audio/webm,audio/opus,audio/dsf,audio/x-dsf,audio/dff,audio/x-dff,application/x-dff',
    ),
    allowedArtworkMimes: csv(env, 'ALLOWED_ARTWORK_MIMES', 'image/jpeg,image/png,image/webp,image/avif'),
    artworkMaxPixels: integer(env, 'ARTWORK_MAX_PIXELS', 40_000_000, 10_000, 200_000_000),
    artworkRequiredForPublish: bool(env, 'ARTWORK_REQUIRED_FOR_PUBLISH', false),
    lyricsProviderUrl: required(env, 'LYRICS_PROVIDER_URL', 'https://lrclib.net'),
    lyricsProviderTimeoutMs: integer(env, 'LYRICS_PROVIDER_TIMEOUT_MS', 4000, 500, 20_000),
    lyricsProviderMaxBytes: integer(env, 'LYRICS_PROVIDER_MAX_BYTES', 262_144, 1024, 2_097_152),
    lyricsPositiveTtlSeconds: integer(env, 'LYRICS_POSITIVE_TTL_SECONDS', 604_800, 60, 31_536_000),
    lyricsNegativeTtlSeconds: integer(env, 'LYRICS_NEGATIVE_TTL_SECONDS', 3600, 30, 86_400),
    importReconcilePrefixes: csvKeepCase(env, 'IMPORT_RECONCILE_PREFIXES', 'ingestion/audio/'),
    importReconcileMaxObjects: integer(env, 'IMPORT_RECONCILE_MAX_OBJECTS', 200, 1, 5_000),
    streamRateLimitMax: integer(env, 'STREAM_RATE_LIMIT_MAX', 120, 1, 10_000),
    adminRateLimitMax: integer(env, 'ADMIN_RATE_LIMIT_MAX', 30, 1, 10_000),
    docsEnabled: bool(env, 'DOCS_ENABLED', nodeEnv !== 'production'),
  };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      MEDIA_PROBE_MODE: 'fake',
      JWT_SECRET: 'test-jwt-secret-value-32-chars-min',
      AUTH_RATE_LIMIT_MAX: '10000',
      STREAM_RATE_LIMIT_MAX: '10000',
      ADMIN_RATE_LIMIT_MAX: '10000',
      COOKIE_SECURE: 'false',
    }),
    ...overrides,
  };
}

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import addFormats from 'ajv-formats';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { authRoutes } from './auth/routes.js';
import { AuthService } from './auth/service.js';
import { createPasswordHasher } from './auth/password.js';
import { AuthRepository, UsersRepository } from './auth/repository.js';
import { CatalogRepository } from './catalog/repository.js';
import { catalogRoutes } from './catalog/routes.js';
import { CatalogService } from './catalog/service.js';
import { type AppConfig } from './config/env.js';
import { favoritesRoutes } from './favorites/routes.js';
import { FavoritesService } from './favorites/service.js';
import { healthRoutes } from './health/routes.js';
import { historyRoutes } from './history/routes.js';
import { HistoryService } from './history/service.js';
import { libraryRoutes } from './library/routes.js';
import { LibraryService } from './library/service.js';
import { loggerRedactPaths } from './logging/redact.js';
import { lyricsRoutes } from './lyrics/routes.js';
import { LyricsService } from './lyrics/service.js';
import { LrclibProvider } from './lyrics/lrclibProvider.js';
import type { LyricsProvider } from './lyrics/provider.js';
import { playlistRoutes } from './playlists/routes.js';
import { PlaylistService } from './playlists/service.js';
import { adminRoutes } from './admin/routes.js';
import { AdminCatalogService } from './admin/catalogService.js';
import { AdminUploadService } from './admin/uploadService.js';
import { AdminImportService } from './admin/importService.js';
import {
  createITunesRemoteArtworkLookup,
  type RemoteArtworkLookup,
} from './ingestion/remoteArtwork.js';
import { AppError, ErrorCodes } from './errors/appError.js';
import { sanitizeRequestId } from './http/requestId.js';
import { authenticateRequest, registerErrorHandler } from './plugins/auth.js';
import { registerObservability } from './plugins/observability.js';
import { MetricsRegistry } from './observability/metrics.js';
import { RolesService } from './rbac/service.js';
import { streamingRoutes } from './streaming/routes.js';
import { StreamingService } from './streaming/service.js';
import { S3ObjectStorageSigner } from './storage/s3Signer.js';
import type { ObjectStorageSigner } from './storage/signer.js';
import { userRoutes } from './users/routes.js';
import { preferencesRoutes } from './preferences/routes.js';
import { PreferencesService } from './preferences/service.js';

export interface BuildAppOptions {
  config: AppConfig;
  pool: Pool;
  signer?: ObjectStorageSigner;
  logger?: boolean | object;
  lyricsProvider?: LyricsProvider;
  playlistService?: PlaylistService;
  favoritesService?: FavoritesService;
  historyService?: HistoryService;
  lyricsService?: LyricsService;
  catalogService?: CatalogService;
  libraryService?: LibraryService;
  rolesService?: RolesService;
  preferencesService?: PreferencesService;
  adminCatalogService?: AdminCatalogService;
  adminUploadService?: AdminUploadService;
  adminImportService?: AdminImportService;
  remoteArtworkLookup?: RemoteArtworkLookup;
  authenticate?: typeof authenticateRequest;
}

export async function buildApp(options: BuildAppOptions) {
  const { config, pool } = options;
  const signer = options.signer ?? new S3ObjectStorageSigner(config.s3);

  const app = Fastify({
    logger: options.logger ?? false,
    disableRequestLogging: options.logger === false,
    trustProxy: config.trustedProxyHops > 0
      ? (_address: string, hop: number) => hop < config.trustedProxyHops
      : false,
    genReqId: (request) => sanitizeRequestId(request.headers['x-request-id']) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    ajv: {
      plugins: [addFormats as never],
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  registerEmptyJsonBodyParser(app);

  const users = new UsersRepository(pool);
  const sessions = new AuthRepository(pool);
  const hasher = createPasswordHasher(config.nodeEnv === 'test');
  const rolesService = options.rolesService ?? new RolesService(pool);
  const authService = new AuthService(pool, users, sessions, hasher, config, rolesService);
  const catalogRepo = new CatalogRepository(pool);
  const catalogService = options.catalogService ?? new CatalogService(catalogRepo);
  const libraryService = options.libraryService ?? new LibraryService(pool, catalogRepo);
  const streamingService = new StreamingService(catalogRepo, signer, config);
  const lyricsProvider = options.lyricsProvider ?? new LrclibProvider(config);
  const playlistService = options.playlistService ?? new PlaylistService(pool, catalogRepo);
  const favoritesService = options.favoritesService ?? new FavoritesService(pool, catalogRepo);
  const historyService = options.historyService ?? new HistoryService(pool, catalogRepo);
  const lyricsService = options.lyricsService ?? new LyricsService(pool, catalogRepo, lyricsProvider, config);
  const remoteArtworkLookup = options.remoteArtworkLookup ?? createITunesRemoteArtworkLookup();
  const adminCatalogService = options.adminCatalogService
    ?? new AdminCatalogService(pool, config, remoteArtworkLookup);
  const adminUploadService = options.adminUploadService ?? new AdminUploadService(pool, signer, config);
  const adminImportService = options.adminImportService
    ?? new AdminImportService(pool, adminUploadService, config, signer, remoteArtworkLookup);
  const preferencesService = options.preferencesService ?? PreferencesService.fromPool(pool);

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('storageSigner', signer);
  app.decorate('authService', authService);
  app.decorate('catalogService', catalogService);
  app.decorate('libraryService', libraryService);
  app.decorate('streamingService', streamingService);
  app.decorate('playlistService', playlistService);
  app.decorate('favoritesService', favoritesService);
  app.decorate('historyService', historyService);
  app.decorate('lyricsService', lyricsService);
  app.decorate('rolesService', rolesService);
  app.decorate('adminCatalogService', adminCatalogService);
  app.decorate('adminUploadService', adminUploadService);
  app.decorate('adminImportService', adminImportService);
  app.decorate('preferencesService', preferencesService);
  app.decorate('authenticate', options.authenticate ?? authenticateRequest);
  const metrics = new MetricsRegistry();
  app.decorate('metrics', metrics);
  registerObservability(app, metrics);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, config.corsOrigins.includes(origin));
    },
    credentials: true,
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
  });

  if (config.docsEnabled) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Nghe Nhac Pro Max Cloud API',
          version: '1.0.0',
          description: 'Cloud backend: auth, catalog, library, playlists, favorites, history, lyrics, and signed streaming URLs.',
        },
        tags: [
          { name: 'Health' },
          { name: 'Auth' },
          { name: 'Users' },
          { name: 'Catalog' },
          { name: 'Library' },
          { name: 'Playlists' },
          { name: 'Favorites' },
          { name: 'History' },
          { name: 'Lyrics' },
          { name: 'Streaming' },
          { name: 'Admin' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });

    app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  registerErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(preferencesRoutes);
  await app.register(catalogRoutes);
  await app.register(libraryRoutes);
  await app.register(playlistRoutes);
  await app.register(favoritesRoutes);
  await app.register(historyRoutes);
  await app.register(lyricsRoutes);
  await app.register(streamingRoutes);
  await app.register(adminRoutes);

  return app;
}

function registerEmptyJsonBodyParser(app: {
  removeContentTypeParser: (contentType: string | string[]) => unknown;
  addContentTypeParser: (
    contentType: string | string[],
    opts: { parseAs: 'string' },
    parser: (request: unknown, body: string, done: (error: Error | null, value?: unknown) => void) => void,
  ) => unknown;
}): void {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    ['application/json', 'application/*+json'],
    { parseAs: 'string' },
    (_request, body, done) => {
      const text = body.trim();
      if (!text) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        done(new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Request validation failed.'));
      }
    },
  );
}

export function productionLoggerOptions(config: AppConfig) {
  return {
    level: config.logLevel,
    redact: {
      paths: loggerRedactPaths(),
      censor: '[Redacted]',
    },
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  };
}

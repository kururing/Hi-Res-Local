import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config/env.js';
import type { AuthService } from './auth/service.js';
import type { CatalogService } from './catalog/service.js';
import type { LibraryService } from './library/service.js';
import type { StreamingService } from './streaming/service.js';
import type { PlaylistService } from './playlists/service.js';
import type { FavoritesService } from './favorites/service.js';
import type { HistoryService } from './history/service.js';
import type { LyricsService } from './lyrics/service.js';
import type { AdminCatalogService } from './admin/catalogService.js';
import type { AdminUploadService } from './admin/uploadService.js';
import type { AdminImportService } from './admin/importService.js';
import type { RolesService } from './rbac/service.js';
import type { ObjectStorageSigner } from './storage/signer.js';
import type { MetricsRegistry } from './observability/metrics.js';
import type { PreferencesService } from './preferences/service.js';
import type { Pool } from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Pool;
    storageSigner: ObjectStorageSigner;
    authService: AuthService;
    catalogService: CatalogService;
    libraryService: LibraryService;
    streamingService: StreamingService;
    playlistService: PlaylistService;
    favoritesService: FavoritesService;
    historyService: HistoryService;
    lyricsService: LyricsService;
    rolesService: RolesService;
    adminCatalogService: AdminCatalogService;
    adminUploadService: AdminUploadService;
    adminImportService: AdminImportService;
    preferencesService: PreferencesService;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    metrics: MetricsRegistry;
  }

  interface FastifyRequest {
    authUser?: {
      id: string;
      sessionId: string;
    };
  }
}

export {};

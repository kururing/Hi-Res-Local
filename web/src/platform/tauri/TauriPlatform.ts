import { TauriAudioEngine } from '../../audio/TauriAudioEngine';
import type { CloudApiClient } from '../../api/client';
import type { AccountApi } from '../../auth/types';
import { IpcService } from '../../services/ipc';
import { TauriAudioConfigurationApi } from '../audio/IpcAudioConfigurationApi';
import { TauriAutostartApi } from '../autostart/TauriAutostartApi';
import { TauriBackupApi } from '../backup/IpcBackupApi';
import type { PlatformApi, PlatformCommandGateway } from '../contracts';
import { TauriFavoritesApi } from '../favorites/IpcFavoritesApi';
import {
  AccountBoundFavoritesApi,
  AccountBoundHistoryApi,
  AccountBoundPlaylistApi,
} from '../hybrid/AccountBoundApis';
import { HybridLibraryApi } from '../hybrid/HybridLibraryApi';
import { HybridLyricsApi } from '../hybrid/HybridLyricsApi';
import { TauriHistoryApi } from '../history/IpcHistoryApi';
import { TauriLibraryApi } from '../library/IpcLibraryApi';
import { TauriLyricsApi } from '../lyrics/IpcLyricsApi';
import { TauriPlaylistApi } from '../playlists/IpcPlaylistApi';
import { TauriPresenceApi } from '../presence/IpcPresenceApi';
import { TauriArtworkAssetsApi } from '../artwork/IpcArtworkAssetsApi';
import { WebStreamingApi } from '../streaming/WebStreamingApi';
import { TauriThemeAssetsApi } from '../theme/IpcThemeAssetsApi';
import { TauriWindowApi } from '../window/TauriWindowApi';
import { UnsupportedAdminCatalogApi } from '../admin/UnsupportedAdminCatalogApi';
import { WebAccountApi } from '../web/WebAccountApi';
import { WebFavoritesApi } from '../web/WebFavoritesApi';
import { WebHistoryApi } from '../web/WebHistoryApi';
import { WebLibraryApi } from '../web/WebLibraryApi';
import { WebLyricsApi } from '../web/WebLyricsApi';
import { WebPlaylistApi } from '../web/WebPlaylistApi';

const commands: PlatformCommandGateway = {
  invoke: (command, args) => IpcService.invoke(command, args),
  listen: (event, callback) => IpcService.listen(event, callback),
};

export interface CreateTauriPlatformOptions {
  cloud?: CloudApiClient;
  account?: AccountApi;
  isAuthenticated?: () => boolean;
}

export function createTauriPlatform(options: CreateTauriPlatformOptions = {}): PlatformApi {
  const cloud = options.cloud ?? null;
  const localLibrary = new TauriLibraryApi(commands);
  const isAuthenticated = options.isAuthenticated ?? (() => false);
  const streaming = cloud ? new WebStreamingApi(cloud) : undefined;

  return {
    runtime: 'tauri',
    capabilities: {
      account: true,
      accountRequired: false,
      cloudApi: true,
      directoryScanning: true,
      localFileSystem: true,
      nativeAudio: true,
      nativeWindowChrome: true,
      remotePlayback: true,
      databaseBackup: true,
      themeImageCache: true,
      discordPresence: true,
      autostart: true,
      adminCatalog: false,
    },
    commands,
    library: cloud
      ? new HybridLibraryApi(localLibrary, new WebLibraryApi(cloud), isAuthenticated)
      : localLibrary,
    playlists: cloud
      ? new AccountBoundPlaylistApi(new WebPlaylistApi(cloud), isAuthenticated)
      : new TauriPlaylistApi(commands),
    favorites: cloud
      ? new AccountBoundFavoritesApi(new WebFavoritesApi(cloud), isAuthenticated)
      : new TauriFavoritesApi(commands),
    history: cloud
      ? new AccountBoundHistoryApi(new WebHistoryApi(cloud), isAuthenticated)
      : new TauriHistoryApi(commands),
    lyrics: cloud
      ? new HybridLyricsApi(new TauriLyricsApi(commands), new WebLyricsApi(cloud), isAuthenticated)
      : new TauriLyricsApi(commands),
    audioConfiguration: new TauriAudioConfigurationApi(commands),
    audioEngine: new TauriAudioEngine(commands, {
      streaming,
      getQuality: () => 'maximum',
    }),
    presence: new TauriPresenceApi(commands),
    window: new TauriWindowApi(commands),
    themeAssets: new TauriThemeAssetsApi(commands),
    artworkAssets: new TauriArtworkAssetsApi(commands),
    backup: new TauriBackupApi(commands),
    autostart: new TauriAutostartApi(),
    account: options.account ?? (cloud ? new WebAccountApi(cloud) : null),
    cloud,
    admin: new UnsupportedAdminCatalogApi('tauri'),
  };
}

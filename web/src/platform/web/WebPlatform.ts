import { CloudApiClient } from '../../api/client';
import type { AccountApi } from '../../auth/types';
import type {
  PlatformApi,
  PlatformCommandGateway,
  PlatformEventCallback,
} from '../contracts';
import { PlatformUnsupportedError } from '../contracts';
import type { IpcCommands, IpcEvents } from '../../types/ipc';
import { BrowserAudioEngine } from '../../audio/BrowserAudioEngine';
import { WebStreamingApi } from '../streaming/WebStreamingApi';
import { WebAccountApi } from './WebAccountApi';
import { WebAudioConfigurationApi } from './WebAudioConfigurationApi';
import { WebBackupApi } from './WebBackupApi';
import { WebFavoritesApi } from './WebFavoritesApi';
import { WebHistoryApi } from './WebHistoryApi';
import { WebLibraryApi } from './WebLibraryApi';
import { WebLyricsApi } from './WebLyricsApi';
import { WebPlaylistApi } from './WebPlaylistApi';
import { WebPresenceApi } from './WebPresenceApi';
import { WebArtworkAssetsApi } from './WebArtworkAssetsApi';
import { WebThemeAssetsApi } from './WebThemeAssetsApi';
import { WebAutostartApi } from './WebAutostartApi';
import { WebWindowApi } from './WebWindowApi';
import { WebAdminCatalogApi } from './WebAdminCatalogApi';
import { WebAudioOutput } from '../../audio/WebAudioOutput';

const unsupportedCommands: PlatformCommandGateway = {
  async invoke<K extends keyof IpcCommands>(
    command: K,
    _args?: IpcCommands[K]['args']
  ): Promise<IpcCommands[K]['return']> {
    throw new PlatformUnsupportedError('web', String(command));
  },
  async listen<K extends keyof IpcEvents>(
    event: K,
    _callback: PlatformEventCallback<K>
  ): Promise<() => void> {
    throw new PlatformUnsupportedError('web', String(event));
  },
};

export function createWebPlatform(
  baseUrl: string,
  cloudClient?: CloudApiClient,
  accountApi?: AccountApi
): PlatformApi {
  const cloud = cloudClient ?? new CloudApiClient({ baseUrl });
  const output = new WebAudioOutput();
  return {
    runtime: 'web',
    capabilities: {
      account: true,
      accountRequired: true,
      cloudApi: true,
      directoryScanning: false,
      localFileSystem: false,
      nativeAudio: false,
      nativeWindowChrome: false,
      remotePlayback: true,
      databaseBackup: false,
      themeImageCache: false,
      discordPresence: false,
      autostart: false,
      adminCatalog: true,
    },
    commands: unsupportedCommands,
    library: new WebLibraryApi(cloud),
    playlists: new WebPlaylistApi(cloud),
    favorites: new WebFavoritesApi(cloud),
    history: new WebHistoryApi(cloud),
    lyrics: new WebLyricsApi(cloud),
    audioConfiguration: new WebAudioConfigurationApi(output),
    audioEngine: new BrowserAudioEngine({
      streaming: new WebStreamingApi(cloud),
      getQuality: () => 'maximum',
      output,
    }),
    presence: new WebPresenceApi(),
    window: new WebWindowApi(),
    themeAssets: new WebThemeAssetsApi(),
    artworkAssets: new WebArtworkAssetsApi(),
    backup: new WebBackupApi(),
    autostart: new WebAutostartApi(),
    account: accountApi ?? new WebAccountApi(cloud),
    cloud,
    admin: new WebAdminCatalogApi(cloud),
  };
}

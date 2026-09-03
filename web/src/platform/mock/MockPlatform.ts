import { MockAudioEngine } from '../../audio/MockAudioEngine';
import type { PlatformApi } from '../contracts';
import { MockWindowApi } from '../window/MockWindowApi';
import { getDefaultMockRuntime, type MockRuntime } from './MockRuntime';
import { UnsupportedAdminCatalogApi } from '../admin/UnsupportedAdminCatalogApi';

export function createMockPlatform(runtime: MockRuntime = getDefaultMockRuntime()): PlatformApi {
  return {
    runtime: 'mock',
    capabilities: {
      account: false,
      accountRequired: false,
      cloudApi: false,
      directoryScanning: false,
      localFileSystem: false,
      nativeAudio: false,
      nativeWindowChrome: false,
      remotePlayback: false,
      databaseBackup: true,
      themeImageCache: true,
      discordPresence: false,
      autostart: true,
      adminCatalog: false,
    },
    commands: runtime.commands,
    library: runtime.library,
    playlists: runtime.playlists,
    favorites: runtime.favorites,
    history: runtime.history,
    lyrics: runtime.lyrics,
    audioConfiguration: runtime.audioConfiguration,
    audioEngine: new MockAudioEngine(),
    presence: runtime.presence,
    window: new MockWindowApi(),
    themeAssets: runtime.themeAssets,
    artworkAssets: runtime.artworkAssets,
    backup: runtime.backup,
    autostart: runtime.autostart,
    account: null,
    cloud: null,
    admin: new UnsupportedAdminCatalogApi('mock'),
  };
}

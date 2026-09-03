import { MockArtworkAssetsApi } from './MockArtworkAssetsApi';
import { MockAudioConfigurationApi } from './MockAudioConfigurationApi';
import { MockAutostartApi } from './MockAutostartApi';
import { MockBackupApi } from './MockBackupApi';
import { MockCommandGateway } from './MockCommandGateway';
import { MockDataStore, type MockDataStoreOptions } from './MockDataStore';
import { MockEventBus } from './MockEventBus';
import { MockFavoritesApi } from './MockFavoritesApi';
import { MockHistoryApi } from './MockHistoryApi';
import { MockLibraryApi } from './MockLibraryApi';
import { MockLyricsApi } from './MockLyricsApi';
import { MockPlaylistApi } from './MockPlaylistApi';
import { MockPresenceApi } from './MockPresenceApi';
import { MockThemeAssetsApi } from './MockThemeAssetsApi';

export interface MockRuntimeOptions extends MockDataStoreOptions {
  scanStepDelayMs?: number;
}

/**
 * One mock preview runtime: a shared store, event bus, domain APIs, and the
 * compatibility command gateway. Playback stays on MockAudioEngine.
 *
 * `getDefaultMockRuntime` exists only so the IpcService compatibility bridge
 * and MockPlatform share state. UI code must not import it.
 */
export class MockRuntime {
  readonly store: MockDataStore;
  readonly events: MockEventBus;
  readonly library: MockLibraryApi;
  readonly playlists: MockPlaylistApi;
  readonly favorites: MockFavoritesApi;
  readonly history: MockHistoryApi;
  readonly lyrics: MockLyricsApi;
  readonly audioConfiguration: MockAudioConfigurationApi;
  readonly themeAssets: MockThemeAssetsApi;
  readonly artworkAssets: MockArtworkAssetsApi;
  readonly backup: MockBackupApi;
  readonly presence: MockPresenceApi;
  readonly autostart: MockAutostartApi;
  readonly commands: MockCommandGateway;

  constructor(options: MockRuntimeOptions = {}) {
    this.store = new MockDataStore({ persist: options.persist });
    this.events = new MockEventBus();
    this.library = new MockLibraryApi(this.store, this.events, options.scanStepDelayMs);
    this.playlists = new MockPlaylistApi(this.store);
    this.favorites = new MockFavoritesApi(this.store);
    this.history = new MockHistoryApi(this.store);
    this.lyrics = new MockLyricsApi(this.store);
    this.audioConfiguration = new MockAudioConfigurationApi(this.store, this.events);
    this.themeAssets = new MockThemeAssetsApi();
    this.artworkAssets = new MockArtworkAssetsApi();
    this.backup = new MockBackupApi();
    this.presence = new MockPresenceApi();
    this.autostart = new MockAutostartApi(this.store);
    this.commands = new MockCommandGateway(this);
  }

  reset(): void {
    this.events.clear();
    this.store.reset();
  }
}

let defaultRuntime: MockRuntime | null = null;

export function getDefaultMockRuntime(): MockRuntime {
  if (!defaultRuntime) {
    defaultRuntime = new MockRuntime({ persist: true });
  }
  return defaultRuntime;
}

export function resetDefaultMockRuntime(): MockRuntime {
  const runtime = getDefaultMockRuntime();
  runtime.reset();
  return runtime;
}

import type { ReplayGainMode } from '../../types/audio';
import type { IpcCommands, IpcEvents } from '../../types/ipc';
import type { PlatformCommandGateway, PlatformEventCallback } from '../contracts';
import type { MockArtworkAssetsApi } from './MockArtworkAssetsApi';
import type { MockAudioConfigurationApi } from './MockAudioConfigurationApi';
import type { MockBackupApi } from './MockBackupApi';
import type { MockDataStore } from './MockDataStore';
import type { MockEventBus } from './MockEventBus';
import type { MockFavoritesApi } from './MockFavoritesApi';
import type { MockHistoryApi } from './MockHistoryApi';
import type { MockLibraryApi } from './MockLibraryApi';
import type { MockPlaylistApi } from './MockPlaylistApi';
import type { MockPresenceApi } from './MockPresenceApi';
import type { MockThemeAssetsApi } from './MockThemeAssetsApi';

export interface MockCommandGatewayDeps {
  store: MockDataStore;
  events: MockEventBus;
  library: MockLibraryApi;
  playlists: MockPlaylistApi;
  favorites: MockFavoritesApi;
  history: MockHistoryApi;
  audioConfiguration: MockAudioConfigurationApi;
  themeAssets: MockThemeAssetsApi;
  artworkAssets: MockArtworkAssetsApi;
  backup: MockBackupApi;
  presence: MockPresenceApi;
}

const PLAYBACK_NOOP_COMMANDS = new Set<keyof IpcCommands>([
  'play_track',
  'play_queue',
  'play_current',
  'pause_playback',
  'resume_playback',
  'stop_playback',
  'seek_playback',
  'set_volume',
  'set_muted',
  'set_loop_mode',
  'set_shuffle',
  'queue_replace',
  'queue_set_index',
  'queue_add',
  'queue_play_next',
  'queue_remove',
  'queue_reorder',
  'queue_clear_upcoming',
  'next_track',
  'previous_track',
  'toggle_mute',
  'get_system_audio_state',
  'get_playback_status',
  'get_saved_playback_state',
]);

/**
 * Legacy command/event bridge for leftover command-gateway tests. Migrated
 * domain commands delegate to the same Mock APIs/store used by MockPlatform —
 * they are not the primary path and must not own separate state.
 *
 * Playback/queue commands are no-ops. MockAudioEngine is the only playback
 * source; this gateway must not emit audio events or mutate queue state.
 */
export class MockCommandGateway implements PlatformCommandGateway {
  constructor(private readonly deps: MockCommandGatewayDeps) {}

  async invoke<K extends keyof IpcCommands>(
    command: K,
    args?: IpcCommands[K]['args']
  ): Promise<IpcCommands[K]['return']> {
    if (PLAYBACK_NOOP_COMMANDS.has(command)) {
      return this.playbackNoop(command) as IpcCommands[K]['return'];
    }

    switch (command) {
      // Deprecated: prefer MockLibraryApi. Kept so IpcService compatibility
      // callers share the same store as MockPlatform.
      case 'get_all_tracks':
        return this.deps.library.getAllTracks() as Promise<IpcCommands[K]['return']>;
      case 'get_library_stats':
        return this.deps.library.getStats() as Promise<IpcCommands[K]['return']>;
      case 'get_library_roots':
        return this.deps.library.getRoots() as Promise<IpcCommands[K]['return']>;
      case 'open_folder_dialog':
        return this.deps.library.pickFolder() as Promise<IpcCommands[K]['return']>;
      case 'add_library_root': {
        const payload = args as IpcCommands['add_library_root']['args'];
        return this.deps.library.addRoot(payload.path, payload.name) as Promise<IpcCommands[K]['return']>;
      }
      case 'remove_library_root_by_path': {
        const payload = args as IpcCommands['remove_library_root_by_path']['args'];
        return this.deps.library.removeRoot(payload.path) as Promise<IpcCommands[K]['return']>;
      }
      case 'scan_directory': {
        const payload = args as IpcCommands['scan_directory']['args'];
        return this.deps.library.scanDirectory(payload.path) as Promise<IpcCommands[K]['return']>;
      }
      case 'scan_library':
        return this.deps.library.scanLibrary() as Promise<IpcCommands[K]['return']>;
      case 'set_directory_watching': {
        const payload = args as IpcCommands['set_directory_watching']['args'];
        return this.deps.library.setDirectoryWatching(payload.enabled) as Promise<IpcCommands[K]['return']>;
      }

      // Deprecated: prefer MockPlaylistApi.
      case 'get_playlists':
        return this.deps.playlists.list() as Promise<IpcCommands[K]['return']>;
      case 'get_playlist': {
        const payload = args as IpcCommands['get_playlist']['args'];
        return this.deps.playlists.get(payload.id) as Promise<IpcCommands[K]['return']>;
      }
      case 'create_playlist': {
        const payload = args as IpcCommands['create_playlist']['args'];
        return this.deps.playlists.create(payload.input) as Promise<IpcCommands[K]['return']>;
      }
      case 'update_playlist': {
        const payload = args as IpcCommands['update_playlist']['args'];
        return this.deps.playlists.update(payload.input) as Promise<IpcCommands[K]['return']>;
      }
      case 'delete_playlist': {
        const payload = args as IpcCommands['delete_playlist']['args'];
        return this.deps.playlists.delete(payload.id) as Promise<IpcCommands[K]['return']>;
      }
      case 'add_tracks_to_playlist': {
        const payload = args as IpcCommands['add_tracks_to_playlist']['args'];
        return this.deps.playlists.addTracks(payload.playlistId, payload.trackIds) as Promise<IpcCommands[K]['return']>;
      }
      case 'remove_tracks_from_playlist': {
        const payload = args as IpcCommands['remove_tracks_from_playlist']['args'];
        return this.deps.playlists.removeTracks(payload.playlistId, payload.trackIds) as Promise<IpcCommands[K]['return']>;
      }
      case 'reorder_playlist_tracks': {
        const payload = args as IpcCommands['reorder_playlist_tracks']['args'];
        return this.deps.playlists.reorderTracks(payload.playlistId, payload.trackIds) as Promise<IpcCommands[K]['return']>;
      }
      case 'open_image_dialog':
        return null as IpcCommands[K]['return'];
      case 'cache_playlist_cover': {
        const payload = args as IpcCommands['cache_playlist_cover']['args'];
        return payload.sourcePath as IpcCommands[K]['return'];
      }

      // Deprecated: prefer MockFavoritesApi.
      case 'set_track_favorite': {
        const payload = args as IpcCommands['set_track_favorite']['args'];
        return this.deps.favorites.setTrackFavorite(payload.id, payload.isFavorite) as Promise<IpcCommands[K]['return']>;
      }
      case 'set_album_favorite': {
        const payload = args as IpcCommands['set_album_favorite']['args'];
        return this.deps.favorites.setAlbumFavorite(
          payload.albumTitle,
          payload.artistName,
          payload.isFavorite,
        ) as Promise<IpcCommands[K]['return']>;
      }
      case 'set_artist_favorite': {
        const payload = args as IpcCommands['set_artist_favorite']['args'];
        return this.deps.favorites.setArtistFavorite(payload.artistName, payload.isFavorite) as Promise<IpcCommands[K]['return']>;
      }
      case 'get_favorite_albums':
        return this.deps.favorites.getFavoriteAlbums() as Promise<IpcCommands[K]['return']>;
      case 'get_favorite_artists':
        return this.deps.favorites.getFavoriteArtists() as Promise<IpcCommands[K]['return']>;

      // Deprecated: prefer MockHistoryApi.
      case 'record_play': {
        const payload = args as IpcCommands['record_play']['args'];
        return this.deps.history.record(payload.input) as Promise<IpcCommands[K]['return']>;
      }
      case 'get_play_history': {
        const payload = (args as IpcCommands['get_play_history']['args'] | undefined) ?? {};
        return this.deps.history.list(payload) as Promise<IpcCommands[K]['return']>;
      }
      case 'clear_play_history':
        return this.deps.history.clear() as Promise<IpcCommands[K]['return']>;

      // Deprecated: prefer MockAudioConfigurationApi.
      case 'get_audio_output_devices':
        return this.deps.audioConfiguration.getOutputDevices() as Promise<IpcCommands[K]['return']>;
      case 'get_audio_capabilities':
        return this.deps.audioConfiguration.getCapabilities() as Promise<IpcCommands[K]['return']>;
      case 'get_asio_drivers':
        return this.deps.audioConfiguration.getAsioDrivers() as Promise<IpcCommands[K]['return']>;
      case 'set_audio_output_device': {
        const payload = args as IpcCommands['set_audio_output_device']['args'];
        return this.deps.audioConfiguration.setOutputDevice(payload.deviceId) as Promise<IpcCommands[K]['return']>;
      }
      case 'apply_playback_mode': {
        const payload = args as IpcCommands['apply_playback_mode']['args'];
        return this.deps.audioConfiguration.applyPlaybackMode(payload) as Promise<IpcCommands[K]['return']>;
      }
      case 'set_equalizer': {
        const payload = args as IpcCommands['set_equalizer']['args'];
        return this.deps.audioConfiguration.setEqualizer(payload.enabled, payload.gains) as Promise<IpcCommands[K]['return']>;
      }
      case 'set_crossfade': {
        const payload = args as IpcCommands['set_crossfade']['args'];
        return this.deps.audioConfiguration.setCrossfade(payload.duration_secs) as Promise<IpcCommands[K]['return']>;
      }
      case 'set_replay_gain': {
        const payload = args as IpcCommands['set_replay_gain']['args'];
        return this.deps.audioConfiguration.setReplayGain({
          mode: payload.mode as ReplayGainMode,
          preamp_db: payload.preamp_db,
          prevent_clipping: payload.prevent_clipping,
        }) as Promise<IpcCommands[K]['return']>;
      }

      // Deprecated: prefer MockThemeAssetsApi / MockArtworkAssetsApi.
      case 'cache_image_data': {
        const payload = args as IpcCommands['cache_image_data']['args'];
        if (payload.category === 'themes') {
          return this.deps.themeAssets.cacheImage({
            cacheKey: payload.cacheKey,
            category: payload.category,
            dataUrl: payload.dataUrl,
          }) as Promise<IpcCommands[K]['return']>;
        }
        return this.deps.artworkAssets.cacheRemoteArtwork(
          payload.cacheKey,
          payload.dataUrl,
        ) as Promise<IpcCommands[K]['return']>;
      }
      case 'clear_image_cache':
        return this.deps.artworkAssets.clearRemoteArtworkCache() as Promise<IpcCommands[K]['return']>;
      case 'get_apple_music_artist_artwork': {
        const payload = args as IpcCommands['get_apple_music_artist_artwork']['args'];
        return this.deps.artworkAssets.getAppleMusicArtistArtwork(
          payload.country,
          payload.artistId,
        ) as Promise<IpcCommands[K]['return']>;
      }

      // Deprecated: prefer MockBackupApi / MockPresenceApi.
      case 'export_database':
        return this.deps.backup.exportDatabase() as Promise<IpcCommands[K]['return']>;
      case 'import_database': {
        const payload = args as IpcCommands['import_database']['args'];
        return this.deps.backup.importDatabase(payload.data) as Promise<IpcCommands[K]['return']>;
      }
      case 'set_discord_presence': {
        const payload = args as IpcCommands['set_discord_presence']['args'];
        return this.deps.presence.setDiscordPresence(
          payload.enabled,
          payload.activity,
        ) as Promise<IpcCommands[K]['return']>;
      }
      case 'get_audio_toml_patch':
        return null as IpcCommands[K]['return'];

      default:
        throw new Error(`Unknown mock command: ${String(command)}`);
    }
  }

  async listen<K extends keyof IpcEvents>(
    event: K,
    callback: PlatformEventCallback<K>
  ): Promise<() => void> {
    return this.deps.events.subscribe(event, callback);
  }

  private playbackNoop(command: keyof IpcCommands): unknown {
    if (command === 'toggle_mute') return false;
    if (command === 'get_system_audio_state') {
      return { volume: 1, is_muted: false };
    }
    if (command === 'get_playback_status') {
      return {
        state: 'stopped',
        current_track: null,
        position: 0,
        duration: 0,
        volume: 1,
        is_muted: false,
        loop_mode: 'off',
        shuffle: false,
      };
    }
    if (command === 'get_saved_playback_state') return null;
    return undefined;
  }
}

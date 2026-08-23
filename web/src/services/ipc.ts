import { IpcCommands, IpcEvents } from '../types/ipc';
import { MOCK_TRACKS, MOCK_PLAYLISTS, MOCK_OUTPUT_DEVICES, getMockStats } from './mock';
import { Storage } from './storage';
import { browserAudioEngine } from './audioEngine';
import { Track, ScanProgress } from '../types/library';
import { Playlist } from '../types/playlist';
import { PlaybackStatus } from '../types/audio';

/**
 * Detects whether the app is executing inside a real Tauri desktop shell.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// In-memory mock state for dev preview
let mockTracks: Track[] = [...MOCK_TRACKS];
let mockPlaylists: Playlist[] = Storage.getPlaylists() || [...MOCK_PLAYLISTS];

// Sync favorites & ratings from storage to mockTracks
function syncMockTracksWithStorage() {
  const favTracks = Storage.getFavoriteTrackIds();
  const ratings = Storage.getRatings();

  mockTracks = mockTracks.map(t => ({
    ...t,
    is_favorite: favTracks.has(t.id),
    rating: ratings[t.id] ?? t.rating ?? 0,
  }));
}

syncMockTracksWithStorage();

type EventCallback<T> = (payload: T) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eventListeners: Record<string, Set<EventCallback<any>>> = {};

async function mockInvokeHandler<K extends keyof IpcCommands>(
  command: K,
  args?: IpcCommands[K]['args']
): Promise<IpcCommands[K]['return']> {
  syncMockTracksWithStorage();

  switch (command) {
    case 'get_all_tracks': {
      return mockTracks as IpcCommands[K]['return'];
    }

    case 'get_track_by_id': {
      const id = (args as { id: string })?.id;
      const track = mockTracks.find(t => t.id === id) || null;
      return track as IpcCommands[K]['return'];
    }

    case 'get_library_stats': {
      return getMockStats(mockTracks) as IpcCommands[K]['return'];
    }

    case 'open_folder_dialog': {
      return 'D:/Music/Hi-Res Collection' as IpcCommands[K]['return'];
    }

    case 'open_files_dialog': {
      return ['D:/Music/Rock/Queen/Bohemian_Rhapsody.flac'] as IpcCommands[K]['return'];
    }

    case 'scan_directory': {
      const path = (args as { path: string })?.path || 'D:/Music';
      const total = 12;
      for (let i = 1; i <= total; i++) {
        await new Promise(r => setTimeout(r, 60));
        const progress: ScanProgress = {
          total_files: total,
          scanned_files: i,
          current_path: `${path}/track_${i}.flac`,
          is_scanning: i < total,
        };
        IpcService.emitMockEvent('library://scan_progress', progress);
      }
      IpcService.emitMockEvent('library://scan_finished', { total, success: true });
      return mockTracks as IpcCommands[K]['return'];
    }

    case 'get_playlists': {
      return mockPlaylists as IpcCommands[K]['return'];
    }

    case 'create_playlist': {
      const payload = args as { name: string; description?: string };
      const newPl: Playlist = {
        id: `pl-${Date.now()}`,
        name: payload.name,
        description: payload.description || '',
        track_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockPlaylists.push(newPl);
      Storage.savePlaylists(mockPlaylists);
      return newPl as IpcCommands[K]['return'];
    }

    case 'update_playlist': {
      const payload = args as { id: string; name?: string; description?: string; track_ids?: string[] };
      const idx = mockPlaylists.findIndex(p => p.id === payload.id);
      if (idx !== -1) {
        mockPlaylists[idx] = {
          ...mockPlaylists[idx],
          name: payload.name ?? mockPlaylists[idx].name,
          description: payload.description ?? mockPlaylists[idx].description,
          track_ids: payload.track_ids ?? mockPlaylists[idx].track_ids,
          updated_at: new Date().toISOString(),
        };
        Storage.savePlaylists(mockPlaylists);
        return mockPlaylists[idx] as IpcCommands[K]['return'];
      }
      throw new Error('Playlist not found');
    }

    case 'delete_playlist': {
      const payload = args as { id: string };
      mockPlaylists = mockPlaylists.filter(p => p.id !== payload.id);
      Storage.savePlaylists(mockPlaylists);
      return true as IpcCommands[K]['return'];
    }

    case 'add_track_to_playlist': {
      const payload = args as { playlist_id: string; track_id: string };
      const pl = mockPlaylists.find(p => p.id === payload.playlist_id);
      if (pl) {
        if (!pl.track_ids.includes(payload.track_id)) {
          pl.track_ids.push(payload.track_id);
          pl.updated_at = new Date().toISOString();
          Storage.savePlaylists(mockPlaylists);
        }
        return true as IpcCommands[K]['return'];
      }
      return false as IpcCommands[K]['return'];
    }

    case 'remove_track_from_playlist': {
      const payload = args as { playlist_id: string; track_id: string };
      const pl = mockPlaylists.find(p => p.id === payload.playlist_id);
      if (pl) {
        pl.track_ids = pl.track_ids.filter(id => id !== payload.track_id);
        pl.updated_at = new Date().toISOString();
        Storage.savePlaylists(mockPlaylists);
        return true as IpcCommands[K]['return'];
      }
      return false as IpcCommands[K]['return'];
    }

    case 'play_track': {
      const track = (args as { track: Track }).track;
      browserAudioEngine.play(track);
      Storage.addHistory(track.id, 0);
      return undefined as IpcCommands[K]['return'];
    }

    case 'pause_playback': {
      browserAudioEngine.pause();
      return undefined as IpcCommands[K]['return'];
    }

    case 'resume_playback': {
      browserAudioEngine.resume();
      return undefined as IpcCommands[K]['return'];
    }

    case 'stop_playback': {
      browserAudioEngine.stop();
      return undefined as IpcCommands[K]['return'];
    }

    case 'seek_playback': {
      const pos = (args as { position_secs: number }).position_secs;
      browserAudioEngine.seek(pos);
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_volume': {
      const vol = (args as { volume: number }).volume;
      browserAudioEngine.setVolume(vol);
      return undefined as IpcCommands[K]['return'];
    }

    case 'toggle_mute': {
      return browserAudioEngine.toggleMute() as IpcCommands[K]['return'];
    }

    case 'set_loop_mode': {
      const mode = (args as { mode: PlaybackStatus['loop_mode'] }).mode;
      browserAudioEngine.setLoopMode(mode);
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_shuffle': {
      const shuffle = (args as { shuffle: boolean }).shuffle;
      browserAudioEngine.setShuffle(shuffle);
      return undefined as IpcCommands[K]['return'];
    }

    case 'get_playback_status': {
      return browserAudioEngine.getStatus() as IpcCommands[K]['return'];
    }

    case 'get_audio_output_devices': {
      return MOCK_OUTPUT_DEVICES as IpcCommands[K]['return'];
    }

    case 'set_audio_output_device': {
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_bit_perfect': {
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_equalizer': {
      const payload = args as { enabled: boolean; gains: number[] };
      browserAudioEngine.setEqualizer(payload.enabled, payload.gains);
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_crossfade': {
      return undefined as IpcCommands[K]['return'];
    }

    default:
      console.warn(`[Mock IPC] Unhandled command: ${command}`);
      return null as IpcCommands[K]['return'];
  }
}

export const IpcService = {
  /**
   * Invokes a typed Tauri backend command.
   */
  async invoke<K extends keyof IpcCommands>(
    command: K,
    args?: IpcCommands[K]['args']
  ): Promise<IpcCommands[K]['return']> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke(command, args as Record<string, unknown>);
      } catch (err) {
        console.warn(`[Tauri IPC] Command "${command}" failed, falling back to mock:`, err);
      }
    }

    return mockInvokeHandler(command, args);
  },

  /**
   * Subscribes to typed Tauri backend events.
   */
  async listen<K extends keyof IpcEvents>(
    event: K,
    callback: EventCallback<IpcEvents[K]>
  ): Promise<() => void> {
    if (isTauri()) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen(event, (evt: { payload: IpcEvents[K] }) => callback(evt.payload));
        return unlisten;
      } catch (err) {
        console.warn(`[Tauri IPC] Event "${event}" subscription failed:`, err);
      }
    }

    if (!eventListeners[event]) {
      eventListeners[event] = new Set();
    }
    const set = eventListeners[event];
    set.add(callback);

    if (event === 'audio://position') {
      const unsub = browserAudioEngine.subscribe({
        onPositionChange: pos => (callback as EventCallback<{ position_secs: number }> )({ position_secs: pos }),
        onStateChange: () => {},
        onTrackEnded: () => {},
        onError: () => {},
      });
      return () => {
        set.delete(callback);
        unsub();
      };
    }

    if (event === 'audio://state_changed') {
      const unsub = browserAudioEngine.subscribe({
        onPositionChange: () => {},
        onStateChange: state => (callback as EventCallback<{ state: string }> )({ state }),
        onTrackEnded: () => {},
        onError: () => {},
      });
      return () => {
        set.delete(callback);
        unsub();
      };
    }

    if (event === 'audio://track_ended') {
      const unsub = browserAudioEngine.subscribe({
        onPositionChange: () => {},
        onStateChange: () => {},
        onTrackEnded: () => (callback as EventCallback<Record<string, never>> )({}),
        onError: () => {},
      });
      return () => {
        set.delete(callback);
        unsub();
      };
    }

    return () => {
      set.delete(callback);
    };
  },

  /**
   * Emit simulated events locally in mock mode.
   */
  emitMockEvent<K extends keyof IpcEvents>(event: K, payload: IpcEvents[K]) {
    const set = eventListeners[event];
    if (set) {
      for (const cb of set) {
        (cb as EventCallback<IpcEvents[K]>)(payload);
      }
    }
  },
};

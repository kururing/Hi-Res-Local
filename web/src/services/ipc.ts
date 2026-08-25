import { BackendPlaylist, IpcCommands, IpcEvents } from '../types/ipc';
import { MOCK_TRACKS, MOCK_PLAYLISTS, MOCK_OUTPUT_DEVICES, getMockStats, SAMPLE_LRC_ROMANIZED } from './mock';
import { Storage } from './storage';
import { browserAudioEngine } from './audioEngine';
import { parseLrc } from './lrc';
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
const mockRomanizedLyrics = new Map<string, string>();

function toBackendPlaylist(pl: Playlist): BackendPlaylist {
  const plTracks = pl.track_ids
    .map(id => mockTracks.find(track => track.id === id))
    .filter((track): track is Track => Boolean(track));
  return {
    id: pl.id,
    name: pl.name,
    description: pl.description ?? null,
    is_smart: pl.is_smart ?? false,
    rules_json: null,
    cover_art_path: pl.cover_url ?? null,
    track_count: pl.track_ids.length,
    total_duration_ms: plTracks.reduce((sum, track) => sum + (track.duration || 0) * 1000, 0),
    created_at: pl.created_at,
    updated_at: pl.updated_at,
  };
}

// Sync favorites from storage to mockTracks
function syncMockTracksWithStorage() {
  const favTracks = Storage.getFavoriteTrackIds();

  mockTracks = mockTracks.map(t => ({
    ...t,
    is_favorite: favTracks.has(t.id),
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
    case 'set_discord_presence': {
      return undefined as IpcCommands[K]['return'];
    }
    case 'record_play': {
      const input = (args as { input: { track_id: string; completed_duration_ms: number; fully_played: boolean } }).input;
      Storage.addHistory(input.track_id, input.completed_duration_ms / 1000);
      const track = mockTracks.find(item => item.id === input.track_id) ?? null;
      return {
        id: Date.now(),
        track_id: input.track_id,
        track,
        played_at: new Date().toISOString(),
        completed_duration_ms: input.completed_duration_ms,
        fully_played: input.fully_played,
      } as IpcCommands[K]['return'];
    }
    case 'get_play_history': {
      const limit = (args as { limit?: number } | undefined)?.limit ?? 100;
      return Storage.getHistory().slice(0, limit).map((item, index) => ({
        id: index + 1,
        track_id: item.track_id,
        track: mockTracks.find(track => track.id === item.track_id) ?? null,
        played_at: item.played_at,
        completed_duration_ms: item.duration_played * 1000,
        fully_played: false,
      })) as IpcCommands[K]['return'];
    }
    case 'clear_play_history': {
      const count = Storage.getHistory().length;
      localStorage.removeItem('nghenhac_history_v2');
      return count as IpcCommands[K]['return'];
    }
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
      return mockPlaylists.map(toBackendPlaylist) as IpcCommands[K]['return'];
    }

    case 'get_playlist': {
      const payload = args as { id: string };
      const pl = mockPlaylists.find(p => p.id === payload.id);
      if (!pl) throw new Error('Playlist not found');
      const plTracks = pl.track_ids
        .map(id => mockTracks.find(track => track.id === id))
        .filter((track): track is Track => Boolean(track));
      return { playlist: toBackendPlaylist(pl), tracks: plTracks } as IpcCommands[K]['return'];
    }

    case 'create_playlist': {
      const payload = args as IpcCommands['create_playlist']['args'];
      const newPl: Playlist = {
        id: `pl-${Date.now()}`,
        name: payload.input.name,
        description: payload.input.description || '',
        track_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockPlaylists.push(newPl);
      Storage.savePlaylists(mockPlaylists);
      return toBackendPlaylist(newPl) as IpcCommands[K]['return'];
    }

    case 'update_playlist': {
      const payload = args as IpcCommands['update_playlist']['args'];
      const idx = mockPlaylists.findIndex(p => p.id === payload.input.id);
      if (idx !== -1) {
        mockPlaylists[idx] = {
          ...mockPlaylists[idx],
          name: payload.input.name ?? mockPlaylists[idx].name,
          description: payload.input.description ?? mockPlaylists[idx].description,
          updated_at: new Date().toISOString(),
        };
        Storage.savePlaylists(mockPlaylists);
        return toBackendPlaylist(mockPlaylists[idx]) as IpcCommands[K]['return'];
      }
      throw new Error('Playlist not found');
    }

    case 'delete_playlist': {
      const payload = args as { id: string };
      mockPlaylists = mockPlaylists.filter(p => p.id !== payload.id);
      Storage.savePlaylists(mockPlaylists);
      return true as IpcCommands[K]['return'];
    }

    case 'add_tracks_to_playlist': {
      const payload = args as { playlistId: string; trackIds: string[] };
      const pl = mockPlaylists.find(p => p.id === payload.playlistId);
      let added = 0;
      if (pl) {
        for (const trackId of payload.trackIds) {
          if (!pl.track_ids.includes(trackId)) {
            pl.track_ids.push(trackId);
            added++;
          }
        }
        pl.updated_at = new Date().toISOString();
        Storage.savePlaylists(mockPlaylists);
      }
      return added as IpcCommands[K]['return'];
    }

    case 'remove_tracks_from_playlist': {
      const payload = args as { playlistId: string; trackIds: string[] };
      const pl = mockPlaylists.find(p => p.id === payload.playlistId);
      let removed = 0;
      if (pl) {
        const removeSet = new Set(payload.trackIds);
        const before = pl.track_ids.length;
        pl.track_ids = pl.track_ids.filter(id => !removeSet.has(id));
        removed = before - pl.track_ids.length;
        pl.updated_at = new Date().toISOString();
        Storage.savePlaylists(mockPlaylists);
      }
      return removed as IpcCommands[K]['return'];
    }

    case 'reorder_playlist_tracks': {
      const payload = args as { playlistId: string; trackIds: string[] };
      const pl = mockPlaylists.find(p => p.id === payload.playlistId);
      if (pl) {
        pl.track_ids = [...payload.trackIds];
        pl.updated_at = new Date().toISOString();
        Storage.savePlaylists(mockPlaylists);
      }
      return undefined as IpcCommands[K]['return'];
    }

    case 'play_track': {
      const track = (args as { track: Track }).track;
      browserAudioEngine.play(track);
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
      const pos = (args as { positionSecs: number }).positionSecs;
      browserAudioEngine.seek(pos);
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_volume': {
      const vol = (args as { volume: number }).volume;
      browserAudioEngine.setVolume(vol);
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_muted': {
      const muted = (args as { muted: boolean }).muted;
      browserAudioEngine.setMuted(muted);
      return undefined as IpcCommands[K]['return'];
    }

    case 'toggle_mute': {
      return browserAudioEngine.toggleMute() as IpcCommands[K]['return'];
    }

    case 'get_system_audio_state': {
      const audio = browserAudioEngine.getStatus();
      return {
        volume: audio.volume,
        is_muted: audio.is_muted,
      } as IpcCommands[K]['return'];
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

    case 'get_audio_capabilities': {
      return {
        exclusive_mode_supported: false,
        media_controls_supported: false,
        gapless_supported: true,
        replay_gain_supported: true,
        equalizer_supported: true,
      } as IpcCommands[K]['return'];
    }

    case 'set_audio_output_device': {
      return undefined as IpcCommands[K]['return'];
    }

    case 'set_exclusive_mode': {
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

    case 'set_replay_gain': {
      return undefined as IpcCommands[K]['return'];
    }

    case 'get_track_lyrics': {
      const payload = args as { trackId: string };
      const track = mockTracks.find(t => t.id === payload.trackId);
      if (!track || !track.lyrics) {
        return null as IpcCommands[K]['return'];
      }
      const romanizedContent =
        mockRomanizedLyrics.get(track.id) ||
        (track.id === 'track-13' ? SAMPLE_LRC_ROMANIZED : undefined);
      const parsed = parseLrc(track.lyrics, romanizedContent);
      return parsed as IpcCommands[K]['return'];
    }

    case 'parse_lrc_content': {
      const payload = args as { content: string };
      const parsed = parseLrc(payload.content);
      return parsed as IpcCommands[K]['return'];
    }

    case 'save_romanized_lyrics': {
      const payload = args as { trackId: string; content: string };
      const track = mockTracks.find(t => t.id === payload.trackId);
      if (!track) throw new Error('Track not found');
      if (!payload.content.trim()) throw new Error('Romanized lyrics file is empty');
      mockRomanizedLyrics.set(track.id, payload.content);
      return parseLrc(track.lyrics || '', payload.content) as IpcCommands[K]['return'];
    }

    case 'quit_app': {
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
        console.error(`[Tauri IPC] Command "${command}" failed:`, err);
        throw err;
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
        console.error(`[Tauri IPC] Event "${event}" subscription failed:`, err);
        throw err;
      }
    }

    if (!eventListeners[event]) {
      eventListeners[event] = new Set();
    }
    const set = eventListeners[event];
    set.add(callback);

    if (event === 'audio://position') {
      const unsub = browserAudioEngine.subscribe({
        onPositionChange: pos => {
          const status = browserAudioEngine.getStatus();
          (callback as EventCallback<{ position_secs: number; duration_secs?: number }> )({
            position_secs: pos,
            duration_secs: status.duration,
          });
        },
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

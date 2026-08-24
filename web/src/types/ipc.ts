import { Track, LibraryStats, ScanProgress } from './library';
import { PlaybackStatus, LoopMode, AudioCapabilities, AudioOutputDevice } from './audio';
import { LyricData } from './lyrics';

/** Playlist row as stored/returned by the Rust backend. */
export interface BackendPlaylist {
  id: string;
  name: string;
  description?: string | null;
  is_smart: boolean;
  rules_json?: string | null;
  cover_art_path?: string | null;
  track_count: number;
  total_duration_ms: number;
  created_at: string;
  updated_at: string;
}

export interface PlayHistoryEntry {
  id: number;
  track_id: string;
  track: Track | null;
  played_at: string;
  completed_duration_ms: number;
  fully_played: boolean;
}

/**
 * Tauri IPC Command definitions.
 * This file acts as the explicit contract between Rust backend and TypeScript frontend.
 */
export interface IpcCommands {
  'set_discord_presence': {
    args: {
      enabled: boolean;
      activity: {
        title: string;
        artist: string;
        position_secs: number;
        duration_secs: number;
      } | null;
    };
    return: void;
  };
  // Library Commands
  'scan_directory': { args: { path: string }; return: Track[] };
  'get_all_tracks': { args: Record<string, never>; return: Track[] };
  'get_track_by_id': { args: { id: string }; return: Track | null };
  'get_library_stats': { args: Record<string, never>; return: LibraryStats };
  'open_folder_dialog': { args: Record<string, never>; return: string | null };
  'open_files_dialog': { args: Record<string, never>; return: string[] | null };
  
  // Playlist Commands (backend shapes: create/update take an `input` object,
  // membership commands operate on arrays of track ids)
  'get_playlists': { args: Record<string, never>; return: BackendPlaylist[] };
  'get_playlist': { args: { id: string }; return: { playlist: BackendPlaylist; tracks: Track[] } };
  'create_playlist': {
    args: { input: { name: string; description?: string | null; is_smart?: boolean | null; rules_json?: string | null } };
    return: BackendPlaylist;
  };
  'update_playlist': {
    args: { input: { id: string; name?: string | null; description?: string | null; rules_json?: string | null; cover_art_path?: string | null } };
    return: BackendPlaylist;
  };
  'delete_playlist': { args: { id: string }; return: boolean };
  'add_tracks_to_playlist': { args: { playlistId: string; trackIds: string[] }; return: number };
  'remove_tracks_from_playlist': { args: { playlistId: string; trackIds: string[] }; return: number };
  'reorder_playlist_tracks': { args: { playlistId: string; trackIds: string[] }; return: void };

  // Favorites (SQLite-backed)
  'set_track_favorite': { args: { id: string; isFavorite: boolean }; return: void };
  'set_album_favorite': { args: { albumTitle: string; artistName: string; isFavorite: boolean }; return: void };
  'set_artist_favorite': { args: { artistName: string; isFavorite: boolean }; return: void };
  'get_favorite_albums': { args: Record<string, never>; return: { album_title: string; artist_name: string }[] };
  'get_favorite_artists': { args: Record<string, never>; return: string[] };

  // Audio Playback Commands
  'play_track': { args: { track: Track }; return: void };
  'play_queue': { args: { tracks: Track[]; startIndex: number }; return: void };
  'play_current': { args: Record<string, never>; return: void };
  'next_track': { args: Record<string, never>; return: void };
  'previous_track': { args: Record<string, never>; return: void };
  'pause_playback': { args: Record<string, never>; return: void };
  'resume_playback': { args: Record<string, never>; return: void };
  'stop_playback': { args: Record<string, never>; return: void };
  'seek_playback': { args: { positionSecs: number }; return: void };
  'set_volume': { args: { volume: number }; return: void };
  'toggle_mute': { args: Record<string, never>; return: boolean };
  'set_loop_mode': { args: { mode: LoopMode }; return: void };
  'set_shuffle': { args: { shuffle: boolean }; return: void };
  'get_playback_status': { args: Record<string, never>; return: PlaybackStatus };

  // Queue Commands (backend-owned queue)
  'queue_add': { args: { tracks: Track[] }; return: void };
  'queue_play_next': { args: { track: Track }; return: void };
  'queue_remove': { args: { index: number }; return: void };
  'queue_reorder': { args: { from: number; to: number }; return: void };
  'queue_clear_upcoming': { args: Record<string, never>; return: void };
  'queue_set_index': { args: { index: number }; return: void };

  // Listening History
  'record_play': {
    args: {
      input: {
        track_id: string;
        completed_duration_ms: number;
        fully_played: boolean;
      };
    };
    return: PlayHistoryEntry;
  };
  'get_play_history': {
    args: { limit?: number; offset?: number };
    return: PlayHistoryEntry[];
  };
  'clear_play_history': { args: Record<string, never>; return: number };

  // Audio Output & Hardware
  'get_audio_output_devices': { args: Record<string, never>; return: AudioOutputDevice[] };
  'get_audio_capabilities': { args: Record<string, never>; return: AudioCapabilities };
  'set_audio_output_device': { args: { device_id: string }; return: void };
  'set_bit_perfect': { args: { enabled: boolean }; return: void };
  'set_equalizer': { args: { enabled: boolean; gains: number[] }; return: void };
  'set_crossfade': { args: { duration_secs: number }; return: void };
  'set_replay_gain': { args: { mode: string; preamp_db: number; prevent_clipping: boolean }; return: void };

  // Lyrics Commands
  'get_track_lyrics': { args: { track_id: string }; return: LyricData | null };
  'parse_lrc_content': { args: { content: string }; return: LyricData };
  'save_romanized_lyrics': { args: { track_id: string; content: string }; return: LyricData };
}

/**
 * Tauri IPC Event definitions (listen from backend)
 */
export interface IpcEvents {
  'audio://position': { position_secs: number; duration_secs?: number };
  'audio://state_changed': { state: string };
  'audio://track_changed': Track | null;
  'audio://track_ended': Record<string, never>;
  'audio://error': { message: string };
  'library://scan_progress': ScanProgress;
  'library://scan_finished': { total: number; success: boolean };
}

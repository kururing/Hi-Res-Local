import { Track, LibraryStats, ScanProgress } from './library';
import { Playlist } from './playlist';
import { PlaybackStatus, LoopMode, AudioOutputDevice } from './audio';

/**
 * Tauri IPC Command definitions.
 * This file acts as the explicit contract between Rust backend and TypeScript frontend.
 */
export interface IpcCommands {
  // Library Commands
  'scan_directory': { args: { path: string }; return: Track[] };
  'get_all_tracks': { args: Record<string, never>; return: Track[] };
  'get_track_by_id': { args: { id: string }; return: Track | null };
  'get_library_stats': { args: Record<string, never>; return: LibraryStats };
  'open_folder_dialog': { args: Record<string, never>; return: string | null };
  'open_files_dialog': { args: Record<string, never>; return: string[] | null };
  
  // Playlist Commands
  'get_playlists': { args: Record<string, never>; return: Playlist[] };
  'create_playlist': { args: { name: string; description?: string }; return: Playlist };
  'update_playlist': { args: { id: string; name?: string; description?: string; track_ids?: string[] }; return: Playlist };
  'delete_playlist': { args: { id: string }; return: boolean };
  'add_track_to_playlist': { args: { playlist_id: string; track_id: string }; return: boolean };
  'remove_track_from_playlist': { args: { playlist_id: string; track_id: string }; return: boolean };

  // Audio Playback Commands
  'play_track': { args: { track: Track }; return: void };
  'pause_playback': { args: Record<string, never>; return: void };
  'resume_playback': { args: Record<string, never>; return: void };
  'stop_playback': { args: Record<string, never>; return: void };
  'seek_playback': { args: { position_secs: number }; return: void };
  'set_volume': { args: { volume: number }; return: void };
  'toggle_mute': { args: Record<string, never>; return: boolean };
  'set_loop_mode': { args: { mode: LoopMode }; return: void };
  'set_shuffle': { args: { shuffle: boolean }; return: void };
  'get_playback_status': { args: Record<string, never>; return: PlaybackStatus };

  // Audio Output & Hardware
  'get_audio_output_devices': { args: Record<string, never>; return: AudioOutputDevice[] };
  'set_audio_output_device': { args: { device_id: string }; return: void };
  'set_bit_perfect': { args: { enabled: boolean }; return: void };
  'set_equalizer': { args: { enabled: boolean; gains: number[] }; return: void };
  'set_crossfade': { args: { duration_secs: number }; return: void };
}

/**
 * Tauri IPC Event definitions (listen from backend)
 */
export interface IpcEvents {
  'audio://position': { position_secs: number };
  'audio://state_changed': { state: string };
  'audio://track_ended': Record<string, never>;
  'audio://error': { message: string };
  'library://scan_progress': ScanProgress;
  'library://scan_finished': { total: number; success: boolean };
}

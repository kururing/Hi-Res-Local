import type { EngineStatus, LoopMode, PlaybackStatus, SystemAudioState } from '../types/audio';
import type { SavedPlaybackState } from '../types/ipc';
import type { Track } from '../types/library';

export type AudioEngineKind = 'tauri' | 'browser' | 'remote' | 'mock';
export type QueueOwnership = 'engine' | 'client';

export interface ExclusiveModeStatus {
  enabled: boolean;
  outputMode: string;
  error?: string | null;
}

export interface NativeDsdStatus {
  active: boolean;
  dsdRate?: string | null;
  error?: string | null;
}

export interface VolumeStatus {
  volume: number;
  isMuted: boolean;
}

/**
 * Runtime-independent playback events. Payloads are app types, not Tauri
 * listen envelopes.
 */
export interface AudioEngineListener {
  onPositionChange?: (positionSeconds: number, durationSeconds?: number) => void;
  onStateChange?: (state: string) => void;
  onTrackChange?: (track: Track | null) => void;
  onTrackEnded?: () => void;
  onEngineStatus?: (status: EngineStatus) => void;
  onExclusiveMode?: (status: ExclusiveModeStatus) => void;
  onNativeDsdStatus?: (status: NativeDsdStatus) => void;
  onError?: (error: Error) => void;
  onDeviceLost?: (message: string) => void;
  onVolumeChange?: (status: VolumeStatus) => void;
}

/**
 * Transport, queue, volume, and saved-playback contract. Output device, ASIO,
 * equalizer, crossfade, replay gain, and playback-mode application belong to
 * `audioConfiguration`, not this engine.
 */
export interface AudioEngine {
  readonly kind: AudioEngineKind;
  readonly queueOwnership: QueueOwnership;

  getStatus(): Promise<PlaybackStatus>;
  getSavedPlaybackState(): Promise<SavedPlaybackState | null>;
  getSystemAudioState(): Promise<SystemAudioState>;

  playTrack(track: Track, startPositionSeconds?: number): Promise<void>;
  playQueue(
    tracks: Track[],
    startIndex: number,
    startPositionSeconds?: number
  ): Promise<void>;
  playCurrent(): Promise<void>;

  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionSeconds: number): Promise<void>;

  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setLoopMode(mode: LoopMode): Promise<void>;
  setShuffle(shuffle: boolean): Promise<void>;

  replaceQueue(tracks: Track[], currentIndex: number): Promise<void>;
  setQueueIndex(index: number): Promise<void>;
  addToQueue(tracks: Track[]): Promise<void>;
  playNext(track: Track): Promise<void>;
  removeFromQueue(index: number): Promise<void>;
  reorderQueue(from: number, to: number): Promise<void>;
  clearUpcoming(): Promise<void>;

  subscribe(listener: AudioEngineListener): () => void;
}

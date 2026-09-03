import type { LoopMode, PlaybackState, PlaybackStatus, SystemAudioState } from '../types/audio';
import type { SavedPlaybackState } from '../types/ipc';
import type { Track } from '../types/library';
import type { AudioEngine, AudioEngineListener } from './contracts';

const POSITION_TICK_MS = 250;
const POSITION_TICK_SECONDS = 0.25;

function clampPosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return position;
  return Math.min(position, duration);
}

/**
 * Timer-based preview engine. It does not stream URLs, open AudioContext, or
 * own the playback queue — PlayerContext keeps the client-owned queue.
 */
export class MockAudioEngine implements AudioEngine {
  readonly kind = 'mock' as const;
  readonly queueOwnership = 'client' as const;

  private currentTrack: Track | null = null;
  private state: PlaybackState = 'stopped';
  private position = 0;
  private duration = 0;
  private volume = 1;
  private isMuted = false;
  private loopMode: LoopMode = 'off';
  private shuffle = false;
  private listeners = new Set<AudioEngineListener>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private trackEndedNotified = false;

  getStatus(): Promise<PlaybackStatus> {
    return Promise.resolve({
      state: this.state,
      current_track: this.currentTrack,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      is_muted: this.isMuted,
      loop_mode: this.loopMode,
      shuffle: this.shuffle,
    });
  }

  getSavedPlaybackState(): Promise<SavedPlaybackState | null> {
    return Promise.resolve(null);
  }

  getSystemAudioState(): Promise<SystemAudioState> {
    return Promise.resolve({
      volume: this.volume,
      is_muted: this.isMuted,
    });
  }

  async playTrack(track: Track, startPositionSeconds = 0): Promise<void> {
    this.currentTrack = track;
    this.duration = track.duration || 180;
    this.position = clampPosition(startPositionSeconds, this.duration);
    this.trackEndedNotified = false;
    this.setState('playing');
    this.notifyPosition();
    this.startSimulationTimer();
  }

  async playQueue(
    tracks: Track[],
    startIndex: number,
    startPositionSeconds = 0
  ): Promise<void> {
    const track = tracks[startIndex];
    if (!track) return;
    await this.playTrack(track, startPositionSeconds);
  }

  async playCurrent(): Promise<void> {
    if (this.currentTrack) {
      await this.playTrack(this.currentTrack, this.position);
    }
  }

  async pause(): Promise<void> {
    if (this.state === 'playing') {
      this.setState('paused');
      this.stopSimulationTimer();
    }
  }

  async resume(): Promise<void> {
    if (this.state === 'paused' && this.currentTrack) {
      this.trackEndedNotified = false;
      this.setState('playing');
      this.startSimulationTimer();
    }
  }

  async stop(): Promise<void> {
    this.setState('stopped');
    this.position = 0;
    this.trackEndedNotified = false;
    this.stopSimulationTimer();
    this.notifyPosition();
  }

  async next(): Promise<void> {
    // Client-owned queue: PlayerContext advances; do not mutate preview queue.
  }

  async previous(): Promise<void> {
    // Client-owned queue: PlayerContext advances; do not mutate preview queue.
  }

  async seek(positionSeconds: number): Promise<void> {
    this.position = clampPosition(positionSeconds, this.duration);
    this.trackEndedNotified = this.position >= this.duration && this.duration > 0;
    this.notifyPosition();
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, volume));
    this.notifyVolume();
  }

  async setMuted(muted: boolean): Promise<void> {
    this.isMuted = muted;
    this.notifyVolume();
  }

  async setLoopMode(mode: LoopMode): Promise<void> {
    this.loopMode = mode;
  }

  async setShuffle(shuffle: boolean): Promise<void> {
    this.shuffle = shuffle;
  }

  async replaceQueue(_tracks: Track[], _currentIndex: number): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  async setQueueIndex(_index: number): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  async addToQueue(_tracks: Track[]): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  async playNext(_track: Track): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  async removeFromQueue(_index: number): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  async reorderQueue(_from: number, _to: number): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  async clearUpcoming(): Promise<void> {
    // Intentional no-op: the frontend queue is the source of truth.
  }

  subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(emit: (listener: AudioEngineListener) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        emit(listener);
      } catch (error) {
        console.error('MockAudioEngine listener failed', error);
      }
    }
  }

  private setState(state: PlaybackState): void {
    this.state = state;
    this.notify(listener => listener.onStateChange?.(state));
  }

  private notifyPosition(): void {
    this.notify(listener => listener.onPositionChange?.(this.position, this.duration));
  }

  private notifyVolume(): void {
    this.notify(listener => listener.onVolumeChange?.({
      volume: this.volume,
      isMuted: this.isMuted,
    }));
  }

  private notifyTrackEnded(): void {
    if (this.trackEndedNotified) return;
    this.trackEndedNotified = true;
    this.stopSimulationTimer();
    this.notify(listener => listener.onTrackEnded?.());
  }

  private startSimulationTimer(): void {
    this.stopSimulationTimer();
    this.timerId = setInterval(() => {
      if (this.state !== 'playing') return;
      this.position += POSITION_TICK_SECONDS;
      if (this.position >= this.duration) {
        if (this.loopMode === 'track') {
          this.position = 0;
          this.notifyPosition();
          return;
        }
        this.position = this.duration;
        this.notifyPosition();
        this.notifyTrackEnded();
        return;
      }
      this.notifyPosition();
    }, POSITION_TICK_MS);
  }

  private stopSimulationTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

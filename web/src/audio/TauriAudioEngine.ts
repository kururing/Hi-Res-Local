import type { PlatformCommandGateway } from '../platform/contracts';
import { cloudTrackIdOf, isCloudPlayback } from '../platform/hybrid/mergeLibrary';
import type { StreamDescriptor, StreamingApi, StreamQuality } from '../platform/streaming/types';
import { isSignedUrlExpiredOrNear, SIGNED_URL_EXPIRY_SKEW_MS } from './browserMedia';
import type { LoopMode, PlaybackStatus, SystemAudioState } from '../types/audio';
import type { IpcEvents, SavedPlaybackState } from '../types/ipc';
import type { Track } from '../types/library';
import type { AudioEngine, AudioEngineListener } from './contracts';
import { playbackError } from './browserErrors';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function reportSubscribeError(listener: AudioEngineListener, error: unknown): void {
  const wrapped = toError(error);
  console.error('Failed to subscribe to audio engine events', wrapped);
  try {
    listener.onError?.(wrapped);
  } catch (listenerError) {
    console.error('AudioEngine onError handler failed', listenerError);
  }
}

type PlayableTrack = Track & {
  stream_url?: string;
  stream_expires_at?: string;
};

export interface TauriAudioEngineOptions {
  streaming?: StreamingApi;
  getQuality?: () => StreamQuality;
  now?: () => number;
  expirySkewMs?: number;
}

/**
 * Desktop playback adapter. Queue, gapless, crossfade, and auto-advance stay
 * in the Rust engine; this class forwards typed IPC and resolves MinIO signed
 * URLs in memory for cloud tracks.
 */
export class TauriAudioEngine implements AudioEngine {
  readonly kind = 'tauri' as const;
  readonly queueOwnership = 'engine' as const;

  private readonly streaming: StreamingApi | undefined;
  private readonly getQuality: () => StreamQuality;
  private readonly now: () => number;
  private readonly expirySkewMs: number;
  private descriptors = new Map<string, StreamDescriptor>();
  private queued: Track[] = [];
  private queueIndex = 0;
  private renewing = false;
  private playbackGeneration = 0;
  private playbackAbort: AbortController | null = null;
  private switchingGeneration: number | null = null;
  private switchingTrackId: string | null = null;

  constructor(
    private readonly commands: PlatformCommandGateway,
    options: TauriAudioEngineOptions = {},
  ) {
    this.streaming = options.streaming;
    this.getQuality = options.getQuality ?? (() => 'auto');
    this.now = options.now ?? (() => Date.now());
    this.expirySkewMs = options.expirySkewMs ?? SIGNED_URL_EXPIRY_SKEW_MS;
  }

  getStatus(): Promise<PlaybackStatus> {
    return this.commands.invoke('get_playback_status', {});
  }

  getSavedPlaybackState(): Promise<SavedPlaybackState | null> {
    return this.commands.invoke('get_saved_playback_state', {});
  }

  getSystemAudioState(): Promise<SystemAudioState> {
    return this.commands.invoke('get_system_audio_state', {});
  }

  async playTrack(track: Track, startPositionSeconds?: number): Promise<void> {
    const { generation, signal } = this.beginPlaybackSwitch(track.id);
    try {
      const playable = await this.resolvePlayable(track, true, signal);
      this.assertCurrentPlayback(generation);
      this.queued = [track];
      this.queueIndex = 0;
      await this.commands.invoke('play_track', {
        track: playable,
        startPositionSecs: startPositionSeconds,
      });
      this.finishPlaybackSwitch(generation);
    } catch (error) {
      this.finishPlaybackSwitch(generation);
      throw error;
    }
  }

  async playQueue(
    tracks: Track[],
    startIndex: number,
    startPositionSeconds?: number
  ): Promise<void> {
    const target = tracks[startIndex];
    const { generation, signal } = this.beginPlaybackSwitch(target?.id ?? null);
    try {
      const playable = await this.resolveQueueWindow(tracks, startIndex, signal);
      this.assertCurrentPlayback(generation);
      this.queued = tracks;
      this.queueIndex = startIndex;
      await this.commands.invoke('play_queue', {
        tracks: playable,
        startIndex,
        startPositionSecs: startPositionSeconds,
      });
      this.finishPlaybackSwitch(generation);
    } catch (error) {
      this.finishPlaybackSwitch(generation);
      throw error;
    }
  }

  playCurrent(): Promise<void> {
    return this.commands.invoke('play_current');
  }

  pause(): Promise<void> {
    return this.commands.invoke('pause_playback');
  }

  resume(): Promise<void> {
    return this.commands.invoke('resume_playback');
  }

  stop(): Promise<void> {
    this.cancelPendingPlayback();
    return this.commands.invoke('stop_playback');
  }

  next(): Promise<void> {
    return this.commands.invoke('next_track');
  }

  previous(): Promise<void> {
    return this.commands.invoke('previous_track');
  }

  seek(positionSeconds: number): Promise<void> {
    return this.commands.invoke('seek_playback', { positionSecs: positionSeconds });
  }

  setVolume(volume: number): Promise<void> {
    return this.commands.invoke('set_volume', { volume });
  }

  setMuted(muted: boolean): Promise<void> {
    return this.commands.invoke('set_muted', { muted });
  }

  setLoopMode(mode: LoopMode): Promise<void> {
    return this.commands.invoke('set_loop_mode', { mode });
  }

  setShuffle(shuffle: boolean): Promise<void> {
    return this.commands.invoke('set_shuffle', { shuffle });
  }

  async replaceQueue(tracks: Track[], currentIndex: number): Promise<void> {
    this.queued = tracks;
    this.queueIndex = currentIndex;
    const playable = await this.resolveQueueWindow(tracks, currentIndex);
    return this.commands.invoke('queue_replace', { tracks: playable, currentIndex });
  }

  async setQueueIndex(index: number): Promise<void> {
    const track = this.queued[index];
    if (!track) {
      return this.commands.invoke('queue_set_index', { index });
    }

    const { generation, signal } = this.beginPlaybackSwitch(track.id);
    try {
      const playable = await this.resolvePlayable(track, true, signal);
      this.assertCurrentPlayback(generation);
      if (playable.stream_url && playable.stream_expires_at) {
        await this.commands.invoke('refresh_stream_url', {
          trackId: track.id,
          url: playable.stream_url,
          expiresAt: playable.stream_expires_at,
          restartCurrent: false,
        });
        this.assertCurrentPlayback(generation);
      }
      this.queueIndex = index;
      await this.commands.invoke('queue_set_index', { index });
      this.finishPlaybackSwitch(generation);
      void this.prefetchWindow(this.queued, index);
    } catch (error) {
      this.finishPlaybackSwitch(generation);
      throw error;
    }
  }

  async addToQueue(tracks: Track[]): Promise<void> {
    this.queued = [...this.queued, ...tracks];
    return this.commands.invoke('queue_add', { tracks });
  }

  async playNext(track: Track): Promise<void> {
    const insertAt = Math.min(this.queueIndex + 1, this.queued.length);
    this.queued = [
      ...this.queued.slice(0, insertAt),
      track,
      ...this.queued.slice(insertAt),
    ];
    const playable = await this.resolvePlayable(track, true);
    return this.commands.invoke('queue_play_next', { track: playable });
  }

  removeFromQueue(index: number): Promise<void> {
    this.queued = this.queued.filter((_, itemIndex) => itemIndex !== index);
    return this.commands.invoke('queue_remove', { index });
  }

  reorderQueue(from: number, to: number): Promise<void> {
    if (from !== to && from >= 0 && to >= 0 && from < this.queued.length && to < this.queued.length) {
      const next = [...this.queued];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      this.queued = next;
    }
    return this.commands.invoke('queue_reorder', { from, to });
  }

  clearUpcoming(): Promise<void> {
    this.queued = this.queued.slice(0, this.queueIndex + 1);
    return this.commands.invoke('queue_clear_upcoming');
  }

  subscribe(listener: AudioEngineListener): () => void {
    let disposed = false;
    const unlistens: Array<() => void> = [];

    const bind = <K extends keyof IpcEvents>(
      event: K,
      handler: (payload: IpcEvents[K]) => void
    ) => {
      void this.commands.listen(event, payload => {
        if (disposed) return;
        try {
          handler(payload);
        } catch (error) {
          console.error('AudioEngine listener failed', error);
        }
      }).then(unlisten => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistens.push(unlisten);
      }).catch(error => {
        if (!disposed) {
          reportSubscribeError(listener, error);
        }
      });
    };

    bind('audio://position', payload => {
      listener.onPositionChange?.(payload.position_secs, payload.duration_secs);
      void this.renewCurrentIfNeeded();
    });
    bind('audio://state_changed', payload => {
      if (
        this.switchingGeneration != null
        && /^(paused|stopped|ended)$/i.test(payload.state)
      ) {
        return;
      }
      listener.onStateChange?.(payload.state);
    });
    bind('audio://track_changed', payload => {
      if (
        this.switchingGeneration != null
        && payload?.id !== this.switchingTrackId
      ) {
        return;
      }
      listener.onTrackChange?.(payload);
      const index = this.queued.findIndex(track => track.id === payload?.id);
      if (index >= 0) this.queueIndex = index;
      void this.prefetchWindow(this.queued, this.queueIndex);
    });
    bind('audio://track_ended', () => {
      listener.onTrackEnded?.();
    });
    bind('audio://engine_status', payload => {
      listener.onEngineStatus?.(payload);
    });
    bind('audio://exclusive_mode', payload => {
      listener.onExclusiveMode?.({
        enabled: payload.enabled,
        outputMode: payload.output_mode,
        error: payload.error,
      });
    });
    bind('audio://native_dsd_status', payload => {
      listener.onNativeDsdStatus?.({
        active: payload.active,
        dsdRate: payload.dsd_rate,
        error: payload.error,
      });
    });
    bind('audio://error', payload => {
      // The previous decoder can fail while the newly selected cloud track is
      // still waiting for its signed URL. That error belongs to the superseded
      // playback request and must not pause the new selection or show a toast.
      if (this.switchingGeneration != null) return;
      if (this.isCloudForbidden(payload.message)) {
        void this.renewCurrentIfNeeded(true);
        return;
      }
      listener.onError?.(new Error(payload.message));
    });
    bind('audio://device_lost', payload => {
      listener.onDeviceLost?.(payload.error);
    });
    bind('audio://volume_changed', payload => {
      listener.onVolumeChange?.({
        volume: payload.volume,
        isMuted: payload.is_muted,
      });
    });

    return () => {
      disposed = true;
      for (const unlisten of unlistens) {
        try {
          unlisten();
        } catch (error) {
          console.error('Failed to unsubscribe audio engine listener', error);
        }
      }
    };
  }

  private windowIndices(length: number, startIndex: number): number[] {
    if (length === 0) return [];
    const current = ((startIndex % length) + length) % length;
    const next = length > 1 ? (current + 1) % length : current;
    return current === next ? [current] : [current, next];
  }

  private beginPlaybackSwitch(trackId: string | null): { generation: number; signal: AbortSignal } {
    this.playbackGeneration += 1;
    this.playbackAbort?.abort();
    this.playbackAbort = new AbortController();
    this.switchingGeneration = this.playbackGeneration;
    this.switchingTrackId = trackId;
    return { generation: this.playbackGeneration, signal: this.playbackAbort.signal };
  }

  private cancelPendingPlayback(): void {
    this.playbackGeneration += 1;
    this.playbackAbort?.abort();
    this.playbackAbort = null;
    this.switchingGeneration = null;
    this.switchingTrackId = null;
  }

  private finishPlaybackSwitch(generation: number): void {
    if (this.switchingGeneration !== generation) return;
    this.switchingGeneration = null;
    this.switchingTrackId = null;
    this.playbackAbort = null;
  }

  private assertCurrentPlayback(generation: number): void {
    if (generation !== this.playbackGeneration) {
      throw playbackError('REQUEST_ABORTED', true);
    }
  }

  private async resolveQueueWindow(
    tracks: Track[],
    startIndex: number,
    signal?: AbortSignal,
  ): Promise<PlayableTrack[]> {
    if (!tracks.some(isCloudPlayback)) return tracks;
    const resolved = tracks.map(track => this.stripStreamFields(track));
    await Promise.all(this.windowIndices(tracks.length, startIndex).map(async index => {
      resolved[index] = await this.resolvePlayable(tracks[index], true, signal);
    }));
    return resolved;
  }

  private async prefetchWindow(tracks: Track[], startIndex: number): Promise<void> {
    await Promise.all(this.windowIndices(tracks.length, startIndex).map(async index => {
      const track = tracks[index];
      if (!track || !isCloudPlayback(track)) return;
      const playable = await this.resolvePlayable(track, false);
      if (playable.stream_url && playable.stream_expires_at) {
        await this.commands.invoke('refresh_stream_url', {
          trackId: track.id,
          url: playable.stream_url,
          expiresAt: playable.stream_expires_at,
          restartCurrent: false,
        });
      }
    }));
  }

  private isCloudForbidden(message: string): boolean {
    const current = this.queued[this.queueIndex];
    if (!current || !isCloudPlayback(current)) return false;
    return /403|forbidden|access denied/i.test(message);
  }

  private async renewCurrentIfNeeded(force = false): Promise<void> {
    if (this.renewing) return;
    const current = this.queued[this.queueIndex];
    if (!current || !isCloudPlayback(current)) return;
    const cloudId = cloudTrackIdOf(current);
    if (!cloudId) return;
    const descriptor = this.descriptors.get(cloudId);
    if (
      !force
      && (!descriptor || !isSignedUrlExpiredOrNear(descriptor.expiresAt, this.now(), this.expirySkewMs))
    ) {
      return;
    }
    this.renewing = true;
    try {
      const playable = await this.resolvePlayable(current, true);
      if (playable.stream_url && playable.stream_expires_at) {
        await this.commands.invoke('refresh_stream_url', {
          trackId: current.id,
          url: playable.stream_url,
          expiresAt: playable.stream_expires_at,
          restartCurrent: force,
        });
      }
    } catch (error) {
      console.warn('Failed to renew cloud stream URL', error);
    } finally {
      this.renewing = false;
    }
  }

  private stripStreamFields(track: Track): PlayableTrack {
    const { stream_url: _url, stream_expires_at: _expires, ...rest } = track as PlayableTrack;
    return rest;
  }

  private async resolvePlayable(
    track: Track,
    force: boolean,
    signal?: AbortSignal,
  ): Promise<PlayableTrack> {
    // A merged local/cloud track can retain a signed URL from an earlier web
    // playback. Always remove it before handing a local file to the native
    // backend; otherwise the backend prefers HTTP and bypasses its DSF/DFF
    // decoder.
    if (!isCloudPlayback(track)) return this.stripStreamFields(track);
    const clean = this.stripStreamFields(track);

    const cloudId = cloudTrackIdOf(track);
    if (!cloudId) {
      throw new Error('No playable audio source is available for this cloud track.');
    }
    if (!this.streaming) {
      throw new Error('Cloud playback requires a signed stream adapter.');
    }

    const cached = this.descriptors.get(cloudId);
    if (!force && cached && !isSignedUrlExpiredOrNear(cached.expiresAt, this.now(), this.expirySkewMs)) {
      return {
        ...clean,
        stream_url: cached.url,
        stream_expires_at: cached.expiresAt,
      };
    }

    const descriptor = await this.streaming.createStream(cloudId, {
      quality: this.getQuality(),
      supportedFormats: [],
    }, signal);
    this.descriptors.set(cloudId, descriptor);
    return {
      ...clean,
      stream_url: descriptor.url,
      stream_expires_at: descriptor.expiresAt,
    };
  }
}

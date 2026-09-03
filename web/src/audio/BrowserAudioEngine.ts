import type { LoopMode, PlaybackState, PlaybackStatus, SystemAudioState } from '../types/audio';
import type { SavedPlaybackState } from '../types/ipc';
import type { Track } from '../types/library';
import type { StreamDescriptor, StreamingApi, StreamQuality } from '../platform/streaming/types';
import { isDsdFormat } from '@nnpm/audio-contracts';
import { CorePlaybackSession } from './core/CorePlaybackSession';
import type { PcmPlaybackHandlers, PcmPlaybackSession } from './PcmPlaybackSession';
import type { AudioEngine, AudioEngineListener, VolumeStatus } from './contracts';
import {
  isExpectedPlaybackAbort,
  normalizePlaybackError,
  playbackError,
} from './browserErrors';
import {
  clampMediaVolume,
  clampPlaybackPosition,
  isSignedUrlExpiredOrNear,
  resolvePlaybackDuration,
  SIGNED_URL_EXPIRY_SKEW_MS,
  withStreamPresentation,
} from './browserMedia';
import {
  buildBrowserEngineStatus,
  emptyBrowserEngineStatus,
} from './browserEngineStatus';
import type { WebAudioOutput } from './WebAudioOutput';

export interface BrowserAudioEngineOptions {
  streaming: StreamingApi;
  getQuality: () => StreamQuality;
  now?: () => number;
  expirySkewMs?: number;
  createPcmSession?: (handlers: PcmPlaybackHandlers) => PcmPlaybackSession;
  output?: WebAudioOutput;
}

/**
 * nnpm-audio-core + Web Audio playback for the web runtime. Queue ownership stays
 * on PlayerContext. Signed URLs stay in memory only.
 */
export class BrowserAudioEngine implements AudioEngine {
  readonly kind = 'browser' as const;
  readonly queueOwnership = 'client' as const;

  private readonly streaming: StreamingApi;
  private readonly getQuality: () => StreamQuality;
  private readonly createPcmSession: (handlers: PcmPlaybackHandlers) => PcmPlaybackSession;
  private readonly now: () => number;
  private readonly expirySkewMs: number;

  private generation = 0;
  private abort: AbortController | null = null;
  private descriptor: StreamDescriptor | null = null;
  private currentTrack: Track | null = null;
  private state: PlaybackState = 'stopped';
  private position = 0;
  private duration = 0;
  private volume = 1;
  private isMuted = false;
  private loopMode: LoopMode = 'off';
  private shuffle = false;
  private listeners = new Set<AudioEngineListener>();
  private pendingSeek: number | null = null;
  private metadataReady = false;
  private endedNotified = false;
  private switching = false;
  private stopping = false;
  private playIntent = false;
  private renewing = false;
  private renewAttemptedForGeneration = false;
  private errorEmittedForGeneration = false;
  private lastEmittedVolume: VolumeStatus | null = null;
  private pcmSession: PcmPlaybackSession | null = null;

  constructor(options: BrowserAudioEngineOptions) {
    this.streaming = options.streaming;
    this.getQuality = options.getQuality;
    this.createPcmSession = options.createPcmSession
      ?? (handlers => new CorePlaybackSession(handlers, undefined, options.output));
    this.now = options.now ?? (() => Date.now());
    this.expirySkewMs = options.expirySkewMs ?? SIGNED_URL_EXPIRY_SKEW_MS;
  }

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
    const generation = ++this.generation;
    this.renewAttemptedForGeneration = false;
    this.errorEmittedForGeneration = false;
    this.abortInFlight();
    this.switching = true;
    this.stopping = false;
    this.endedNotified = false;
    this.playIntent = true;
    this.metadataReady = false;
    this.pendingSeek = startPositionSeconds > 0 ? startPositionSeconds : null;
    await this.stopSessions();
    this.currentTrack = track;
    this.descriptor = null;
    this.duration = resolvePlaybackDuration(null, track);
    this.position = clampPlaybackPosition(startPositionSeconds, this.duration);
    this.setState('loading');
    this.notifyPosition();

    try {
      const descriptor = await this.requestDescriptor(track.id, generation);
      if (generation !== this.generation) return;
      this.applyDescriptor(descriptor, track, true);
      await this.playPcm(descriptor, this.pendingSeek ?? startPositionSeconds, generation);
    } catch (error) {
      if (generation !== this.generation || isExpectedPlaybackAbort(error)) return;
      this.switching = false;
      this.playIntent = false;
      this.setState(this.currentTrack ? 'paused' : 'stopped');
      this.emitError(error);
      throw normalizePlaybackError(error);
    }
  }

  async playQueue(tracks: Track[], startIndex: number, startPositionSeconds = 0): Promise<void> {
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
    this.playIntent = false;
    if (this.pcmSession) {
      await this.pcmSession.pause();
      if (this.state === 'playing' || this.state === 'loading') this.setState('paused');
    }
  }

  async resume(): Promise<void> {
    if (!this.currentTrack || this.state === 'stopped') return;
    const generation = this.generation;
    this.playIntent = true;
    this.endedNotified = false;
    await this.ensureFreshDescriptor(generation);
    if (generation !== this.generation) return;
    if (this.pcmSession) {
      await this.pcmSession.resume();
      this.setState('playing');
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.stopping = true;
    this.playIntent = false;
    this.abortInFlight();
    this.descriptor = null;
    this.pendingSeek = null;
    this.metadataReady = false;
    this.endedNotified = false;
    this.renewAttemptedForGeneration = false;
    this.position = 0;
    this.setState('stopped');
    this.notifyPosition();
    await this.stopSessions();
    this.emitEngineStatus(true);
    this.stopping = false;
  }

  async next(): Promise<void> {
    // Client-owned queue: PlayerContext advances; do not create a second queue.
  }

  async previous(): Promise<void> {
    // Client-owned queue: PlayerContext advances; do not create a second queue.
  }

  async seek(positionSeconds: number): Promise<void> {
    const duration = resolvePlaybackDuration(this.pcmSession?.getDuration(), this.currentTrack);
    const clamped = clampPlaybackPosition(positionSeconds, duration);
    this.position = clamped;
    this.notifyPosition();

    if (!this.currentTrack || this.state === 'stopped') return;

    if (!this.metadataReady) {
      this.pendingSeek = clamped;
      return;
    }

    const generation = this.generation;
    if (this.pcmSession && this.descriptor) {
      await this.ensureFreshDescriptor(generation);
      if (generation !== this.generation || !this.descriptor) return;
      await this.pcmSession.seek(clamped, this.descriptor.url);
    }
  }

  async setVolume(volume: number): Promise<void> {
    const next = clampMediaVolume(volume);
    if (this.volume === next) return;
    this.volume = next;
    this.pcmSession?.setVolume(next, this.isMuted);
    this.emitVolumeIfChanged();
  }

  async setMuted(muted: boolean): Promise<void> {
    if (this.isMuted === muted) return;
    this.isMuted = muted;
    this.pcmSession?.setVolume(this.volume, muted);
    this.emitVolumeIfChanged();
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

  dispose(): void {
    this.generation += 1;
    this.abortInFlight();
    this.setState('stopped');
    void this.stopSessions();
    this.listeners.clear();
  }

  private isDsdDescriptor(descriptor: StreamDescriptor): boolean {
    return isDsdFormat(descriptor.asset.codec, descriptor.asset.container)
      || descriptor.asset.isDsd === true;
  }

  private async stopSessions(): Promise<void> {
    const pcm = this.pcmSession;
    this.pcmSession = null;
    await pcm?.stop();
  }

  private pcmHandlers(generation: number): PcmPlaybackHandlers {
    return {
      onEnded: () => {
        if (generation !== this.generation || this.endedNotified) return;
        this.endedNotified = true;
        this.playIntent = false;
        this.position = this.duration;
        this.notifyPosition();
        this.notify(listener => listener.onStateChange?.('ended'));
      },
      onError: error => {
        if (generation !== this.generation) return;
        void this.onSessionError(error);
      },
      onPosition: (position, duration) => {
        if (generation !== this.generation) return;
        this.position = position;
        this.duration = duration;
        this.notifyPosition();
      },
    };
  }

  private async playPcm(
    descriptor: StreamDescriptor,
    startPositionSeconds: number,
    generation: number,
  ): Promise<void> {
    await this.stopSessions();
    const session = this.createPcmSession(this.pcmHandlers(generation));
    this.pcmSession = session;
    session.setVolume(this.volume, this.isMuted);
    const start = this.pendingSeek ?? startPositionSeconds;
    await session.play({
      url: descriptor.url,
      getFreshUrl: async () => {
        const next = await this.requestDescriptor(this.currentTrack?.id ?? '', generation);
        if (generation !== this.generation) throw playbackError('REQUEST_ABORTED', true);
        if (this.currentTrack) this.applyDescriptor(next, this.currentTrack, false);
        this.emitEngineStatus();
        return next.url;
      },
      startSeconds: start,
      durationSeconds: resolvePlaybackDuration(null, this.currentTrack),
      sampleRate: this.browserPcmOutputRate(descriptor),
      channels: descriptor.asset.channels,
      bitDepth: descriptor.asset.bitDepth,
      container: descriptor.asset.container,
      signal: this.abort?.signal,
    });
    if (generation !== this.generation) {
      await session.stop();
      return;
    }
    if (this.pendingSeek != null && this.pendingSeek !== start) {
      await session.seek(this.pendingSeek, descriptor.url);
      if (generation !== this.generation) {
        await session.stop();
        return;
      }
    }
    this.pendingSeek = null;
    this.metadataReady = true;
    this.duration = session.getDuration() || this.duration;
    this.position = session.getPosition();
    this.switching = false;
    this.setState('playing');
    this.notifyPosition();
    this.emitEngineStatus();
  }

  private browserPcmOutputRate(descriptor: StreamDescriptor): number {
    const sourceRate = descriptor.asset.sampleRateHz;
    if (!this.isDsdDescriptor(descriptor)) return sourceRate;
    // DSD source rates exceed AudioContext limits. The core decimator emits
    // low-pass filtering and converts to the matching high-rate PCM family.
    return sourceRate % 48_000 === 0 ? 192_000 : 176_400;
  }

  private abortInFlight(): void {
    this.abort?.abort();
    this.abort = new AbortController();
  }

  private async requestDescriptor(trackId: string, generation: number): Promise<StreamDescriptor> {
    const signal = this.abort?.signal;
    const descriptor = await this.streaming.createStream(trackId, {
      quality: this.getQuality(),
      supportedFormats: [],
    }, signal);
    if (generation !== this.generation) {
      throw playbackError('REQUEST_ABORTED', true);
    }
    return descriptor;
  }

  private applyDescriptor(descriptor: StreamDescriptor, track: Track, emitTrackChange: boolean): void {
    this.descriptor = descriptor;
    const presented = withStreamPresentation(track, descriptor);
    this.currentTrack = presented;
    this.duration = resolvePlaybackDuration(null, presented);
    if (emitTrackChange) {
      this.notify(listener => listener.onTrackChange?.(presented));
    }
  }

  private shouldRenew(): boolean {
    if (!this.descriptor) return true;
    if (this.pcmSession && !this.pcmSession.needsSourceUrl()) return false;
    return isSignedUrlExpiredOrNear(this.descriptor.expiresAt, this.now(), this.expirySkewMs);
  }

  private async ensureFreshDescriptor(generation: number): Promise<void> {
    if (!this.shouldRenew()) return;
    await this.renew(generation);
  }

  private async renew(generation: number): Promise<void> {
    if (!this.currentTrack || this.renewing || generation !== this.generation) return;
    this.renewing = true;
    const track = this.currentTrack;
    const position = this.position;
    const shouldPlay = this.playIntent;
    try {
      const descriptor = await this.requestDescriptor(track.id, generation);
      if (generation !== this.generation) return;
      this.applyDescriptor(descriptor, track, false);
      this.emitEngineStatus();
      await this.playPcm(descriptor, position, generation);
      if (!shouldPlay) await this.pause();
    } catch (error) {
      if (generation !== this.generation || isExpectedPlaybackAbort(error)) return;
      this.playIntent = false;
      this.setState('paused');
      this.emitError(error, { signedUrlExpired: true });
      throw error;
    } finally {
      this.renewing = false;
    }
  }

  private async onSessionError(error: unknown): Promise<void> {
    if (this.stopping || this.switching) return;
    const expired = this.descriptor
      ? isSignedUrlExpiredOrNear(this.descriptor.expiresAt, this.now(), this.expirySkewMs)
      : false;
    if (expired && !this.renewAttemptedForGeneration && this.currentTrack) {
      this.renewAttemptedForGeneration = true;
      try {
        await this.renew(this.generation);
        return;
      } catch {
        return;
      }
    }
    this.playIntent = false;
    this.setState('paused');
    this.emitError(error, { signedUrlExpired: expired });
  }

  private setState(state: PlaybackState): void {
    if (this.state === state) return;
    this.state = state;
    this.notify(listener => listener.onStateChange?.(state));
  }

  private notifyPosition(): void {
    this.notify(listener => listener.onPositionChange?.(this.position, this.duration));
  }

  private emitVolumeIfChanged(): void {
    const next = { volume: this.volume, isMuted: this.isMuted };
    if (
      this.lastEmittedVolume
      && this.lastEmittedVolume.volume === next.volume
      && this.lastEmittedVolume.isMuted === next.isMuted
    ) {
      return;
    }
    this.lastEmittedVolume = next;
    this.notify(listener => listener.onVolumeChange?.(next));
    this.emitEngineStatus();
  }

  private emitEngineStatus(cleared = false): void {
    if (cleared || this.state === 'stopped' || !this.descriptor) {
      this.notify(listener => listener.onEngineStatus?.(emptyBrowserEngineStatus(this.volume)));
      return;
    }
    const dsd = this.isDsdDescriptor(this.descriptor);
    this.notify(listener => listener.onEngineStatus?.(buildBrowserEngineStatus({
      track: this.currentTrack,
      descriptor: this.descriptor,
      volume: this.volume,
      dsd,
      dsdOutputSampleRate: dsd ? this.pcmSession?.getOutputSampleRate() : undefined,
      pcmOutputSampleRate: this.pcmSession?.getOutputSampleRate(),
      pcmOutputBitDepth: this.pcmSession?.getOutputBitDepth(),
      quality: this.getQuality(),
    })));
  }

  private emitError(error: unknown, options?: { signedUrlExpired?: boolean }): void {
    const normalized = normalizePlaybackError(error, options);
    if (normalized.expected || this.errorEmittedForGeneration) return;
    this.errorEmittedForGeneration = true;
    this.notify(listener => listener.onError?.(normalized));
  }

  private notify(emit: (listener: AudioEngineListener) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        emit(listener);
      } catch (error) {
        console.error('BrowserAudioEngine listener failed', error);
      }
    }
  }
}

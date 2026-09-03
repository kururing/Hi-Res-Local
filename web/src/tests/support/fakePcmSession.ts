import { clampPlaybackPosition } from '../../audio/browserMedia';
import { playbackError } from '../../audio/browserErrors';
import type {
  PcmPlayRequest,
  PcmPlaybackHandlers,
  PcmPlaybackSession,
} from '../../audio/PcmPlaybackSession';

export class FakePcmSession implements PcmPlaybackSession {
  url = '';
  playError: Error | null = null;
  autoReady = true;
  outputSampleRate = 44_100;
  private duration = 0;
  private position = 0;
  private volume = 1;
  private muted = false;
  private sourceReady = false;
  private readyWaiters: Array<() => void> = [];
  private stopped = false;

  constructor(private readonly handlers: PcmPlaybackHandlers) {}

  ready(): void {
    this.autoReady = true;
    const waiters = this.readyWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  fail(error: Error = playbackError('NETWORK')): void {
    this.handlers.onError(error);
  }

  finish(): void {
    this.position = this.duration;
    this.handlers.onPosition(this.position, this.duration);
    this.handlers.onEnded();
  }

  setPosition(positionSeconds: number): void {
    this.position = clampPlaybackPosition(positionSeconds, this.duration);
    this.handlers.onPosition(this.position, this.duration);
  }

  needsSourceUrl(): boolean {
    return !this.sourceReady;
  }

  getDuration(): number {
    return this.duration;
  }

  getPosition(): number {
    return this.position;
  }

  getOutputSampleRate(): number {
    return this.outputSampleRate;
  }

  getOutputBitDepth(): number {
    return 32;
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
  }

  getVolume(): { volume: number; muted: boolean } {
    return { volume: this.volume, muted: this.muted };
  }

  async play(request: PcmPlayRequest): Promise<void> {
    this.stopped = false;
    this.url = request.url;
    this.duration = Math.max(0, request.durationSeconds);
    this.outputSampleRate = request.sampleRate > 0 ? request.sampleRate : 44_100;
    this.position = clampPlaybackPosition(request.startSeconds, this.duration);
    if (this.playError) {
      const error = this.playError;
      this.playError = error;
      return Promise.reject(error);
    }
    if (!this.autoReady) {
      await new Promise<void>(resolve => {
        this.readyWaiters.push(resolve);
      });
    }
    if (this.playError) {
      const error = this.playError;
      return Promise.reject(error);
    }
    if (this.stopped) return;
    this.sourceReady = true;
    this.handlers.onPosition(this.position, this.duration);
  }

  async pause(): Promise<void> {
    return Promise.resolve();
  }

  async resume(): Promise<void> {
    if (this.playError) return Promise.reject(this.playError);
    return Promise.resolve();
  }

  async seek(positionSeconds: number, url: string): Promise<void> {
    this.url = url;
    this.setPosition(positionSeconds);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.sourceReady = false;
    this.url = '';
    this.position = 0;
    this.ready();
  }
}

export function createFakePcmHarness() {
  let current: FakePcmSession | null = null;
  return {
    get session() {
      if (!current) throw new Error('No FakePcmSession has been created yet.');
      return current;
    },
    get sessionOrNull() {
      return current;
    },
    createSession: (handlers: PcmPlaybackHandlers) => {
      current = new FakePcmSession(handlers);
      return current;
    },
  };
}

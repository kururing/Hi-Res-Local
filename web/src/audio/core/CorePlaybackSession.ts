import { clampPlaybackPosition } from '../browserMedia';
import { PlaybackError, playbackError } from '../browserErrors';
import { PcmOutputGraph } from '../PcmOutputGraph';
import type { PcmPlayRequest, PcmPlaybackHandlers, PcmPlaybackSession } from '../PcmPlaybackSession';
import { CORE_CHUNK_SECONDS, WasmCoreDecoder, type CoreDecoder } from './CoreDecoder';
import type { WebAudioOutput } from '../WebAudioOutput';

export const CORE_MAX_BUFFER_SECONDS = 8;
export const CORE_LOW_WATER_SECONDS = 3;

export function corePcmBufferIsFull(cursorSeconds: number, positionSeconds: number): boolean {
  return cursorSeconds - positionSeconds >= CORE_MAX_BUFFER_SECONDS;
}

export function corePcmShouldDecode(
  cursorSeconds: number,
  positionSeconds: number,
  filling: boolean,
): { decode: boolean; filling: boolean } {
  const buffered = cursorSeconds - positionSeconds;
  if (filling) {
    if (buffered >= CORE_MAX_BUFFER_SECONDS) return { decode: false, filling: false };
    return { decode: true, filling: true };
  }
  if (buffered <= CORE_LOW_WATER_SECONDS) return { decode: true, filling: true };
  return { decode: false, filling: false };
}

export class CorePlaybackSession implements PcmPlaybackSession {
  private graph: PcmOutputGraph | null = null;
  private abort: AbortController | null = null;
  private decoder: CoreDecoder;
  private duration = 0;
  private position = 0;
  private sampleRate = 44_100;
  private channels = 2;
  private startedAt = 0;
  private pausedAt: number | null = 0;
  private volume = 1;
  private muted = false;
  private sourceReady = false;
  private positionTimer: number | null = null;
  private disposed = false;
  private decodeLoop: Promise<void> | null = null;
  private lastRequest: PcmPlayRequest | null = null;

  constructor(
    private readonly handlers: PcmPlaybackHandlers,
    decoder?: CoreDecoder,
    private readonly output?: WebAudioOutput,
  ) {
    this.decoder = decoder ?? new WasmCoreDecoder();
  }

  needsSourceUrl(): boolean {
    return !this.sourceReady;
  }

  getDuration(): number {
    return this.duration;
  }

  getPosition(): number {
    if (!this.graph || this.pausedAt != null) return this.pausedAt ?? this.position;
    return Math.min(
      this.duration,
      Math.max(0, this.graph.audioContext.currentTime - this.startedAt),
    );
  }

  getOutputSampleRate(): number {
    return this.sampleRate;
  }

  getOutputBitDepth(): number {
    return 32;
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.graph?.setVolume(volume, muted);
  }

  async play(request: PcmPlayRequest): Promise<void> {
    await this.stopInternal();
    this.abort = new AbortController();
    const controller = this.abort;
    const local = this.abort.signal;
    if (request.signal) {
      request.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    this.duration = Math.max(0, request.durationSeconds);
    this.sampleRate = request.sampleRate > 0 ? request.sampleRate : 44_100;
    this.channels = request.channels > 0 ? request.channels : 2;
    this.position = clampPlaybackPosition(request.startSeconds, this.duration);
    this.pausedAt = null;
    this.lastRequest = request;

    try {
      await this.decoder.open({
        url: request.url,
        getFreshUrl: request.getFreshUrl,
        signal: request.signal,
      });
      if (local.aborted) throw playbackError('REQUEST_ABORTED', true);
      const format = this.decoder.decodedFormat();
      if (format) {
        this.sampleRate = format.sampleRate;
        this.channels = format.channels;
        if (format.durationSeconds > 0) this.duration = format.durationSeconds;
      }
      this.sourceReady = true;
      this.graph = await PcmOutputGraph.create(this.sampleRate, this.channels, this.output);
      this.graph.setVolume(this.volume, this.muted);
      await this.graph.audioContext.resume();
      this.startedAt = this.graph.audioContext.currentTime - this.position;
      const firstWindow = Math.min(CORE_CHUNK_SECONDS, Math.max(0.05, this.duration - this.position || CORE_CHUNK_SECONDS));
      const first = await this.decoder.decodeWindow(this.position, firstWindow, this.channels, this.sampleRate, local);
      if (local.aborted) throw playbackError('REQUEST_ABORTED', true);
      if (first.frames.length === 0) throw playbackError('DECODE');
      this.graph.pushPcm(first.frames, first.channels);
      this.armPosition();
      const firstPlayed = first.frames.length / Math.max(1, first.channels) / this.sampleRate;
      this.decodeLoop = this.stream(this.position + firstPlayed, local);
      void this.decodeLoop.catch(error => {
        if (local.aborted || this.disposed) return;
        this.handlers.onError(error instanceof Error ? error : playbackError('DECODE'));
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') {
        throw playbackError('AUTOPLAY_BLOCKED');
      }
      throw error;
    }
  }

  async pause(): Promise<void> {
    this.pausedAt = this.getPosition();
    this.position = this.pausedAt;
    await this.graph?.audioContext.suspend();
  }

  async resume(): Promise<void> {
    if (!this.graph) return;
    const paused = this.pausedAt ?? this.position;
    await this.graph.audioContext.resume();
    this.startedAt = this.graph.audioContext.currentTime - paused;
    this.pausedAt = null;
  }

  async seek(positionSeconds: number, url: string): Promise<void> {
    const next = clampPlaybackPosition(positionSeconds, this.duration);
    this.position = next;
    this.pausedAt = null;
    this.handlers.onPosition(next, this.duration);
    if (!this.sourceReady) {
      await this.play({
        url,
        getFreshUrl: this.lastRequest?.getFreshUrl,
        startSeconds: next,
        durationSeconds: this.duration,
        sampleRate: this.sampleRate,
        channels: this.channels,
        bitDepth: 32,
        container: '',
        signal: this.lastRequest?.signal,
      });
      return;
    }
    this.graph?.flush();
    const previousLoop = this.decodeLoop;
    this.abort?.abort();
    await previousLoop?.catch(() => undefined);
    this.decoder.prepareSeek();
    this.abort = new AbortController();
    const local = this.abort.signal;
    this.lastRequest?.signal?.addEventListener('abort', () => this.abort?.abort(), { once: true });
    if (this.graph) {
      this.startedAt = this.graph.audioContext.currentTime - next;
    }
    this.decodeLoop = this.stream(next, local);
    void this.decodeLoop.catch(error => {
      if (local.aborted || this.disposed) return;
      this.handlers.onError(error instanceof Error ? error : playbackError('DECODE'));
    });
  }

  async stop(): Promise<void> {
    await this.stopInternal();
  }

  private armPosition(): void {
    this.clearPosition();
    this.positionTimer = window.setInterval(() => {
      const position = this.getPosition();
      this.position = position;
      this.handlers.onPosition(position, this.duration);
      if (this.duration > 0 && position >= this.duration) {
        this.clearPosition();
        this.handlers.onEnded();
      }
    }, 200);
  }

  private clearPosition(): void {
    if (this.positionTimer != null) {
      window.clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  private async stream(startSeconds: number, signal: AbortSignal): Promise<void> {
    let cursor = startSeconds;
    let filling = true;
    while (cursor < this.duration && !signal.aborted && !this.disposed) {
      const decision = corePcmShouldDecode(cursor, this.getPosition(), filling);
      filling = decision.filling;
      if (!decision.decode) {
        await abortableDelay(50, signal);
        continue;
      }
      if (signal.aborted || this.disposed) return;
      const windowDuration = Math.min(CORE_CHUNK_SECONDS, this.duration - cursor);
      let chunk;
      try {
        chunk = await this.decoder.decodeWindow(cursor, windowDuration, this.channels, this.sampleRate, signal);
      } catch (error) {
        if (error instanceof PlaybackError && error.code === 'DECODE') {
          this.duration = Math.min(this.duration, cursor);
          this.handlers.onPosition(this.getPosition(), this.duration);
          return;
        }
        throw error;
      }
      if (signal.aborted || this.disposed) return;
      if (chunk.frames.length === 0) {
        this.duration = Math.min(this.duration, cursor);
        this.handlers.onPosition(this.getPosition(), this.duration);
        return;
      }
      this.graph?.pushPcm(chunk.frames, chunk.channels);
      const played = chunk.frames.length / Math.max(1, chunk.channels) / this.sampleRate;
      cursor += played > 0 ? played : windowDuration;
    }
  }

  private async stopInternal(): Promise<void> {
    this.clearPosition();
    const decodeLoop = this.decodeLoop;
    this.abort?.abort();
    this.abort = null;
    this.decodeLoop = null;
    await decodeLoop?.catch(() => undefined);
    const graph = this.graph;
    this.graph = null;
    await graph?.close();
    await this.decoder.close();
    this.sourceReady = false;
    this.lastRequest = null;
    this.pausedAt = 0;
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

import {
  DsdDecodeError,
  decodeAudio,
  createDsdPcmStream,
  dsdDecodeBlockBytes,
  deinterleaveDsfPlanar,
  initAudioCore,
  parseDsdHeader,
  type DsdHeader,
  type DsdPcmPushStream,
} from '@nnpm/audio-wasm';
import { PCM_RING_WORKLET_NAME, PCM_RING_WORKLET_SOURCE } from '../pcmRingWorklet';
import { clampMediaVolume } from '../browserMedia';
import type { WebAudioOutput } from '../WebAudioOutput';

export interface DsdPlaybackHandlers {
  onEnded(): void;
  onError(error: Error): void;
  onPosition(positionSeconds: number, durationSeconds: number): void;
}

export class DsdPlaybackSession {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private abort: AbortController | null = null;
  private header: DsdHeader | null = null;
  private startedAt = 0;
  private pausedAt: number | null = 0;
  private duration = 0;
  private positionTimer: number | null = null;
  private disposed = false;
  private volume = 1;
  private muted = false;
  private unregisterOutput: (() => void) | null = null;
  private pcmStream: DsdPcmPushStream | null = null;

  constructor(
    private readonly handlers: DsdPlaybackHandlers,
    private readonly output?: WebAudioOutput,
  ) {}

  getDuration(): number {
    return this.duration;
  }

  getOutputSampleRate(): number {
    return this.header?.outputSampleRate ?? 0;
  }

  getDsdRate(): number | null {
    return this.header?.dsdRate ?? null;
  }

  getPosition(): number {
    if (!this.context || this.pausedAt != null) return this.pausedAt ?? 0;
    return Math.min(this.duration, Math.max(0, this.context.currentTime - this.startedAt));
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = clampMediaVolume(volume);
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : this.volume;
  }

  async play(url: string, startSeconds = 0, signal?: AbortSignal): Promise<void> {
    await this.stopInternal();
    this.abort = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => this.abort?.abort(), { once: true });
    }
    const local = this.abort.signal;
    const headerBytes = await fetchRange(url, 0, 96 * 1024 - 1, local);
    const fileSize = headerBytes.fileSize;
    this.header = parseDsdHeader(headerBytes.body, fileSize);
    if (this.header.encoding === 'dst' && this.header.dstStatus === 'unsupported') {
      throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'DST at this DSD rate is not supported.');
    }
    this.duration = this.header.durationMs / 1000;
    const firReady = await initAudioCore();
    if (!firReady) {
      throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM FIR is required');
    }
    this.pcmStream = createDsdPcmStream(
      this.header.channels,
      this.header.lsbFirst,
      this.header.dsdSampleRate,
    );
    const context = new AudioContext({ sampleRate: this.header.outputSampleRate });
    this.context = context;
    this.unregisterOutput = this.output ? await this.output.register(context) : null;
    const blob = new Blob([PCM_RING_WORKLET_SOURCE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await context.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    const node = new AudioWorkletNode(context, PCM_RING_WORKLET_NAME, {
      outputChannelCount: [this.header.channels],
    });
    const gain = context.createGain();
    gain.gain.value = this.muted ? 0 : this.volume;
    node.connect(gain);
    gain.connect(context.destination);
    this.node = node;
    this.gain = gain;

    const startByte = byteOffsetForTime(this.header, startSeconds);
    if (this.header.encoding === 'dst') {
      const ready = await initAudioCore();
      if (!ready) {
        throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'DST64 requires nnpm-audio-core WASM.');
      }
      const response = await fetch(url, { signal: local });
      if (!response.ok) {
        throw new Error(`DSD request failed with status ${response.status}.`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const decoded = decodeAudio(bytes);
      node.port.postMessage(
        { type: 'pcm', frames: decoded.samples, channels: decoded.channels },
        [decoded.samples.buffer],
      );
    } else {
      await this.prebuffer(url, startByte, local);
      void this.stream(url, this.nextOffset(startByte), local).catch(error => {
        if (!local.aborted && !this.disposed) this.handlers.onError(error as Error);
      });
    }
    this.startedAt = context.currentTime - startSeconds;
    this.pausedAt = null;
    this.armPosition();
  }

  async pause(): Promise<void> {
    this.pausedAt = this.getPosition();
    await this.context?.suspend();
  }

  async resume(): Promise<void> {
    if (!this.context) return;
    const paused = this.pausedAt ?? 0;
    await this.context.resume();
    this.startedAt = this.context.currentTime - paused;
    this.pausedAt = null;
  }

  async seek(positionSeconds: number, url: string): Promise<void> {
    await this.play(url, positionSeconds);
  }

  async stop(): Promise<void> {
    await this.stopInternal();
  }

  dispose(): void {
    this.disposed = true;
    void this.stopInternal();
  }

  private armPosition(): void {
    this.clearPosition();
    this.positionTimer = window.setInterval(() => {
      const position = this.getPosition();
      this.handlers.onPosition(position, this.duration);
      if (position >= this.duration && this.duration > 0) {
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

  private async stopInternal(): Promise<void> {
    this.clearPosition();
    this.abort?.abort();
    this.abort = null;
    this.node?.port.postMessage({ type: 'flush' });
    this.node?.disconnect();
    this.node = null;
    this.gain?.disconnect();
    this.gain = null;
    if (this.context) {
      this.unregisterOutput?.();
      this.unregisterOutput = null;
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
    this.header = null;
    this.pcmStream = null;
    this.pausedAt = 0;
  }

  private postPcm(node: AudioWorkletNode, channels: number, pcm: Float32Array): void {
    if (pcm.length === 0) return;
    node.port.postMessage({ type: 'pcm', frames: pcm, channels }, [pcm.buffer]);
  }

  private pcmFromRange(header: DsdHeader, body: Uint8Array, fileOffset: number): Float32Array {
    const dataOffset = Math.max(0, fileOffset - header.dataOffset);
    const physicalBlock = Math.max(1, header.blockSize * header.channels);
    const payload =
      header.container === 'dsf'
        ? deinterleaveDsfPlanar(
            body,
            header.channels,
            header.blockSize,
            Math.floor(dataOffset / physicalBlock) * header.blockSize,
            Math.ceil(header.sampleCount / 8),
          )
        : body;
    return this.pcmStream?.push(payload) ?? new Float32Array();
  }

  private async stream(url: string, startByte: number, signal: AbortSignal): Promise<void> {
    const header = this.header;
    const node = this.node;
    if (!header || !node) return;
    const chunkSize = Math.max(
      header.blockSize * header.channels * 8,
      dsdDecodeBlockBytes(header.dsdSampleRate, header.channels),
    );
    let offset = Math.max(header.dataOffset, startByte);
    const end = header.dataOffset + header.dataSize;
    while (offset < end && !signal.aborted && !this.disposed) {
      const last = Math.min(offset + chunkSize - 1, end - 1);
      const chunk = await fetchRange(url, offset, last, signal);
      const pcm = this.pcmFromRange(header, chunk.body, offset);
      const frames = pcm.length / Math.max(1, header.channels);
      if (frames > 0) {
        node.port.postMessage({ type: 'pcm', frames: pcm, channels: header.channels }, [pcm.buffer]);
      }
      offset = last + 1;
      await abortableDelay(Math.max(10, (frames / header.outputSampleRate) * 500), signal);
    }
    if (!signal.aborted && !this.disposed) {
      this.postPcm(node, header.channels, this.pcmStream?.flush() ?? new Float32Array());
    }
  }

  private nextOffset(startByte: number): number {
    const header = this.header;
    if (!header) return startByte;
    const chunkSize = Math.max(
      header.blockSize * header.channels * 8,
      dsdDecodeBlockBytes(header.dsdSampleRate, header.channels),
    );
    return Math.min(header.dataOffset + header.dataSize, startByte + chunkSize * 3);
  }

  private async prebuffer(url: string, startByte: number, signal: AbortSignal): Promise<void> {
    const header = this.header;
    const node = this.node;
    if (!header || !node) return;
    const chunkSize = Math.max(
      header.blockSize * header.channels * 8,
      dsdDecodeBlockBytes(header.dsdSampleRate, header.channels),
    );
    const end = header.dataOffset + header.dataSize;
    let offset = Math.max(header.dataOffset, startByte);
    for (let count = 0; count < 3 && offset < end; count += 1) {
      const last = Math.min(offset + chunkSize - 1, end - 1);
      const chunk = await fetchRange(url, offset, last, signal);
      const pcm = this.pcmFromRange(header, chunk.body, offset);
      if (pcm.length > 0) {
        node.port.postMessage({ type: 'pcm', frames: pcm, channels: header.channels }, [pcm.buffer]);
      }
      offset = last + 1;
    }
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = window.setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

function byteOffsetForTime(header: DsdHeader, seconds: number): number {
  const clamped = Math.max(0, Math.min(seconds, header.durationMs / 1000));
  const bits = Math.floor(clamped * header.dsdSampleRate) * header.channels;
  const bytes = Math.floor(bits / 8);
  const aligned = Math.floor(bytes / (header.blockSize * header.channels)) * header.blockSize * header.channels;
  return header.dataOffset + aligned;
}

async function fetchRange(
  url: string,
  start: number,
  end: number,
  signal: AbortSignal,
): Promise<{ body: Uint8Array; fileSize: number }> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  });
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`DSD range request failed with status ${response.status}.`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  const lengthHeader = response.headers.get('content-range');
  const total = lengthHeader?.split('/')[1];
  const fileSize = total && total !== '*' ? Number(total) : start + buffer.length;
  return { body: buffer, fileSize };
}

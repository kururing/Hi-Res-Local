import {
  createDsdPcmStream,
  decodeAudio,
  dsdDecodeBlockBytes,
  deinterleaveDsfPlanar,
  initAudioCore,
  isNeedBytes,
  openStreamingSource,
  parseDsdHeader,
  type AudioStreamingDecoder,
  type DsdHeader,
  type DsdPcmPushStream,
  type WasmRangeHost,
} from '@nnpm/audio-wasm';
import { playbackError } from '../browserErrors';
import { loadBoundedWholeFile } from '../source/boundedWholeFile';
import { HttpRangeSource } from '../source/HttpRangeSource';
import {
  expandNeedLength,
  hintExtFromUrl,
  RANGE_HEADER_BYTES,
  RANGE_WINDOW_BYTES,
  type RandomAccessSource,
} from '../source/types';

const CHUNK_SECONDS = 2;

export const CORE_CHUNK_SECONDS = CHUNK_SECONDS;

export interface CorePcmChunk {
  frames: Float32Array;
  channels: number;
}

export interface CoreDecodedFormat {
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

export interface CoreOpenRequest {
  url: string;
  getFreshUrl?: () => Promise<string>;
  signal?: AbortSignal;
}

export interface CoreDecoder {
  open(urlOrRequest: string | CoreOpenRequest, signal?: AbortSignal): Promise<void>;
  decodeWindow(
    startSeconds: number,
    durationSeconds: number,
    channels: number,
    sampleRate: number,
    signal?: AbortSignal,
  ): Promise<CorePcmChunk>;
  decodedFormat(): CoreDecodedFormat | null;
  prepareSeek(): void;
  close(): Promise<void>;
}

/**
 * Copy a PCM window out of the interleaved buffer. The copy must own its
 * ArrayBuffer: AudioWorklet postMessage transfers the buffer, and a shared
 * subarray would detach the decoder's entire file after the first chunk.
 */
export function slicePcmWindow(
  pcm: Float32Array,
  startSeconds: number,
  durationSeconds: number,
  channels: number,
  sampleRate: number,
): CorePcmChunk {
  const ch = Math.max(1, channels);
  const rate = sampleRate > 0 ? sampleRate : 44_100;
  const start = Math.max(0, Math.floor(startSeconds * rate));
  const count = Math.max(0, Math.floor(durationSeconds * rate));
  const begin = start * ch;
  const end = Math.min(pcm.length, begin + count * ch);
  if (begin >= pcm.length) {
    return { frames: new Float32Array(), channels: ch };
  }
  return { frames: pcm.slice(begin, end), channels: ch };
}

export interface WasmCoreDecoderDeps {
  createSource?: (input: { urlProvider: () => Promise<string>; signal?: AbortSignal }) => RandomAccessSource;
  initAudioCore?: () => Promise<boolean>;
  openStreamingSource?: (host: WasmRangeHost, hintExt: string) => AudioStreamingDecoder;
}

export class WasmCoreDecoder implements CoreDecoder {
  private source: RandomAccessSource | null = null;
  private streaming: AudioStreamingDecoder | null = null;
  private pcm: Float32Array | null = null;
  private dsd: { header: DsdHeader; stream: DsdPcmPushStream } | null = null;
  private duration = 0;
  private channels = 2;
  private sampleRate = 44_100;
  private cursorSeconds = 0;
  private hintExt = '';
  private readonly deps: Required<Pick<WasmCoreDecoderDeps, 'initAudioCore' | 'openStreamingSource'>> & WasmCoreDecoderDeps;

  constructor(deps: WasmCoreDecoderDeps = {}) {
    this.deps = {
      createSource: deps.createSource,
      initAudioCore: deps.initAudioCore ?? initAudioCore,
      openStreamingSource: deps.openStreamingSource ?? openStreamingSource,
    };
  }

  async open(urlOrRequest: string | CoreOpenRequest, signal?: AbortSignal): Promise<void> {
    await this.close();
    const request = typeof urlOrRequest === 'string'
      ? { url: urlOrRequest, signal }
      : { ...urlOrRequest, signal: urlOrRequest.signal ?? signal };
    const urlProvider = request.getFreshUrl ?? (async () => request.url);
    this.hintExt = hintExtFromUrl(request.url);
    this.source = this.deps.createSource
      ? this.deps.createSource({ urlProvider, signal: request.signal })
      : new HttpRangeSource({ urlProvider, signal: request.signal });
    await this.source.read(0, RANGE_HEADER_BYTES);
    const peek = this.source.tryReadCached(0, 4) ?? await this.source.read(0, 4);
    const magic = ascii(peek, 0, Math.min(4, peek.length));
    if (magic === 'DSD ' || magic === 'FRM8') {
      await this.openDsd(request.signal);
      return;
    }
    const ready = await this.deps.initAudioCore();
    if (!ready) throw playbackError('UNSUPPORTED_FORMAT');
    await this.openWasm();
    this.source.compactPlayback();
  }

  decodedFormat(): CoreDecodedFormat | null {
    if (!this.pcm && !this.streaming && !this.dsd) return null;
    const channels = Math.max(1, this.channels);
    const sampleRate = this.sampleRate > 0 ? this.sampleRate : 44_100;
    return {
      sampleRate,
      channels,
      durationSeconds: this.pcm
        ? this.pcm.length / channels / sampleRate
        : this.duration,
    };
  }

  prepareSeek(): void {
    this.source?.invalidatePlaybackWindows();
    if (this.dsd) {
      this.dsd.stream = createDsdPcmStream(
        this.dsd.header.channels,
        this.dsd.header.lsbFirst,
        this.dsd.header.dsdSampleRate,
      );
    }
  }

  async decodeWindow(
    startSeconds: number,
    durationSeconds: number,
    channels: number,
    sampleRate: number,
    signal?: AbortSignal,
  ): Promise<CorePcmChunk> {
    if (signal?.aborted) throw playbackError('REQUEST_ABORTED', true);
    if (this.dsd) {
      return this.decodeDsdWindow(startSeconds, durationSeconds, signal);
    }
    if (this.pcm) {
      return slicePcmWindow(
        this.pcm,
        startSeconds,
        durationSeconds,
        this.channels || channels || 2,
        this.sampleRate || sampleRate || 44_100,
      );
    }
    const seek = Math.abs(startSeconds - this.cursorSeconds) > 1 / Math.max(1, this.sampleRate);
    if (seek) {
      this.cursorSeconds = Math.max(0, startSeconds);
      this.source?.invalidatePlaybackWindows();
    }
    if (this.streaming && this.source) {
      const pos = this.streaming.bytePosition();
      if (pos < this.source.size() && !this.source.tryReadCached(pos, 1)) {
        await this.source.read(pos, RANGE_WINDOW_BYTES);
      }
    }
    const frames = await this.runLive(() => {
      if (!this.streaming) throw playbackError('DECODE');
      if (seek) this.streaming.seekMs(Math.floor(Math.max(0, startSeconds) * 1000));
      return this.streaming.decodeChunk(Math.max(1, Math.ceil(durationSeconds * this.sampleRate)));
    }, signal);
    this.cursorSeconds = startSeconds + frames.length / Math.max(1, this.channels) / Math.max(1, this.sampleRate);
    this.duration = Math.max(this.duration, this.cursorSeconds);
    const ahead = this.streaming?.bytePosition() ?? 0;
    void this.source?.read(ahead, RANGE_WINDOW_BYTES).catch(() => undefined);
    return { frames, channels: this.channels };
  }

  async close(): Promise<void> {
    this.streaming?.close();
    this.streaming = null;
    this.pcm = null;
    this.dsd = null;
    this.source?.abort();
    this.source = null;
    this.duration = 0;
    this.cursorSeconds = 0;
    this.hintExt = '';
  }

  private async openDsd(_signal?: AbortSignal): Promise<void> {
    if (!this.source) throw playbackError('DECODE');
    const ready = await this.deps.initAudioCore();
    if (!ready) throw playbackError('UNSUPPORTED_FORMAT');
    const headerBytes = this.source.tryReadCached(0, RANGE_HEADER_BYTES) ?? await this.source.read(0, RANGE_HEADER_BYTES);
    const header = parseDsdHeader(headerBytes, this.source.size());
    if (header.encoding === 'dst') {
      if (header.dstStatus === 'unsupported') throw playbackError('UNSUPPORTED_FORMAT');
      const whole = await loadBoundedWholeFile(this.source);
      const packed = await whole.read(0, whole.size());
      const decoded = decodeAudio(packed);
      this.pcm = decoded.samples;
      this.channels = decoded.channels;
      this.sampleRate = decoded.sampleRate;
      this.duration = decoded.samples.length / Math.max(1, decoded.channels) / Math.max(1, decoded.sampleRate);
      return;
    }
    this.dsd = {
      header,
      stream: createDsdPcmStream(header.channels, header.lsbFirst, header.dsdSampleRate),
    };
    this.channels = header.channels;
    this.sampleRate = header.outputSampleRate;
    this.duration = header.durationMs / 1000;
    this.source.compactPlayback();
  }

  private async decodeDsdWindow(
    startSeconds: number,
    durationSeconds: number,
    signal?: AbortSignal,
  ): Promise<CorePcmChunk> {
    if (!this.dsd || !this.source) throw playbackError('DECODE');
    if (signal?.aborted) throw playbackError('REQUEST_ABORTED', true);
    const header = this.dsd.header;
    const startByte = byteOffsetForTime(header, startSeconds);
    const chunkSize = Math.max(
      header.blockSize * header.channels * 8,
      dsdDecodeBlockBytes(header.dsdSampleRate, header.channels),
    );
    const bytesWanted = Math.max(chunkSize, Math.ceil(durationSeconds * (header.dsdSampleRate * header.channels) / 8));
    const body = await this.source.read(startByte, bytesWanted);
    if (signal?.aborted) throw playbackError('REQUEST_ABORTED', true);
    const dataOffset = Math.max(0, startByte - header.dataOffset);
    const physicalBlock = Math.max(1, header.blockSize * header.channels);
    const payload = header.container === 'dsf'
      ? deinterleaveDsfPlanar(
          body,
          header.channels,
          header.blockSize,
          Math.floor(dataOffset / physicalBlock) * header.blockSize,
          Math.ceil(header.sampleCount / 8),
        )
      : body;
    const frames = this.dsd.stream.push(payload);
    this.cursorSeconds = startSeconds + frames.length / Math.max(1, header.channels) / Math.max(1, header.outputSampleRate);
    return { frames, channels: header.channels };
  }

  private async openWasm(): Promise<void> {
    if (!this.source) throw playbackError('DECODE');
    const host = this.createHost();
    for (let attempt = 0; attempt < 48; attempt += 1) {
      try {
        this.streaming = this.deps.openStreamingSource(host, this.hintExt);
        this.channels = this.streaming.channels;
        this.sampleRate = this.streaming.sampleRate;
        this.duration = this.streaming.durationSeconds;
        this.cursorSeconds = 0;
        return;
      } catch (error) {
        if (!isNeedBytes(error)) throw this.mapOpenError(error);
        await this.source.read(error.needOffset, expandNeedLength(error.needLength));
      }
    }
    throw playbackError('DECODE');
  }

  private async runLive(op: () => Float32Array, signal?: AbortSignal): Promise<Float32Array> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      if (signal?.aborted) throw playbackError('REQUEST_ABORTED', true);
      if (!this.streaming) {
        await this.openWasm();
      }
      const streaming = this.streaming;
      if (this.cursorSeconds > 0 && streaming) {
          try {
            streaming.seekMs(Math.floor(this.cursorSeconds * 1000));
          } catch (error) {
            if (!isNeedBytes(error)) throw this.mapOpenError(error);
            await this.source?.read(error.needOffset, expandNeedLength(error.needLength));
            this.dropStreaming();
            continue;
          }
      }
      try {
        return op();
      } catch (error) {
        if (!isNeedBytes(error)) throw this.mapOpenError(error);
        await this.source?.read(error.needOffset, expandNeedLength(error.needLength));
        this.dropStreaming();
      }
    }
    throw playbackError('DECODE');
  }

  private dropStreaming(): void {
    this.streaming?.close();
    this.streaming = null;
  }

  private createHost(): WasmRangeHost {
    const source = this.source;
    if (!source) throw playbackError('DECODE');
    return {
      get size() {
        return source.size();
      },
      readSync: (offset, length) => {
        if (offset >= source.size()) return new Uint8Array();
        const hit = source.tryReadCached(offset, length);
        if (hit) return hit;
        return { needOffset: offset, needLength: Math.max(1, length) };
      },
    };
  }

  private mapOpenError(error: unknown): Error {
    if (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))) {
      return playbackError('REQUEST_ABORTED', true);
    }
    if (error instanceof Error && 'code' in error) return error;
    return playbackError('DECODE');
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function byteOffsetForTime(header: DsdHeader, seconds: number): number {
  const clamped = Math.max(0, Math.min(seconds, header.durationMs / 1000));
  const bits = Math.floor(clamped * header.dsdSampleRate) * header.channels;
  const bytes = Math.floor(bits / 8);
  const aligned = Math.floor(bytes / (header.blockSize * header.channels)) * header.blockSize * header.channels;
  return header.dataOffset + aligned;
}

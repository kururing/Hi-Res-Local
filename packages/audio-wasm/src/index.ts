export type DsdContainer = 'dsf' | 'dff';
export type DsdEncoding = 'raw' | 'dst';
export type DstStatus = 'none' | 'stable' | 'experimental' | 'unsupported';

export class DsdDecodeError extends Error {
  readonly code: 'UNSUPPORTED_FORMAT' | 'INVALID_CONTAINER';

  constructor(code: 'UNSUPPORTED_FORMAT' | 'INVALID_CONTAINER', message: string) {
    super(message);
    this.name = 'DsdDecodeError';
    this.code = code;
  }
}

export interface DsdHeader {
  container: DsdContainer;
  encoding: DsdEncoding;
  dsdSampleRate: number;
  pcmSampleRate: number;
  outputSampleRate: number;
  dsdRate: number;
  channels: number;
  sampleCount: number;
  durationMs: number;
  dataOffset: number;
  dataSize: number;
  blockSize: number;
  lsbFirst: boolean;
  dstStatus: DstStatus;
}

export interface DecodedAudio {
  samples: Float32Array;
  channels: number;
  sampleRate: number;
}

type DecodedPcmHandle = {
  channels: number;
  sample_rate: number;
  samples: Float32Array;
  free?: () => void;
};

type StreamingHandle = {
  channels: number;
  sample_rate: number;
  duration_ms: number;
  byte_position?: number;
  bytePosition?: number;
  decode_chunk: (maxFrames: number) => Float32Array;
  seek_ms: (targetMs: number) => void;
  free?: () => void;
};

export interface WasmRangeHost {
  readonly size: number;
  readSync: (offset: number, length: number) => Uint8Array | { needOffset: number; needLength: number };
}

export interface NeedBytes {
  needOffset: number;
  needLength: number;
}

export function isNeedBytes(value: unknown): value is NeedBytes {
  if (typeof value !== 'object' || value == null) return false;
  const offset = (value as { needOffset?: unknown }).needOffset;
  return typeof offset === 'number' && Number.isFinite(offset) && offset >= 0;
}

type AudioCoreWasm = {
  default: (module_or_path?: unknown) => Promise<unknown>;
  decode_audio: (bytes: Uint8Array) => DecodedPcmHandle;
  open_streaming: (bytes: Uint8Array) => StreamingHandle;
  openStreamingSource?: (host: WasmRangeHost, hintExt: string) => StreamingHandle;
  open_streaming_source?: (host: WasmRangeHost, hintExt: string) => StreamingHandle;
  dsd_payload_to_pcm_f32: (
    bytes: Uint8Array,
    channels: number,
    lsb_first: boolean,
    dsd_sample_rate: number,
  ) => Float32Array;
  DsdPcmStream?: new (channels: number, lsb_first: boolean, dsd_sample_rate: number) => {
    push: (bytes: Uint8Array) => Float32Array;
    flush: () => Float32Array;
    free?: () => void;
  };
  parse_dsd_header_json: (bytes: Uint8Array) => DsdHeader;
  probe_bytes: (bytes: Uint8Array) => unknown;
};

export interface AudioStreamingDecoder {
  readonly channels: number;
  readonly sampleRate: number;
  readonly durationSeconds: number;
  bytePosition(): number;
  decodeChunk(maxFrames: number): Float32Array;
  seekMs(targetMs: number): void;
  close(): void;
}

function wrapStreamingHandle(handle: StreamingHandle): AudioStreamingDecoder {
  return {
    channels: handle.channels,
    sampleRate: handle.sample_rate,
    durationSeconds: handle.duration_ms / 1000,
    bytePosition: () => Number(handle.bytePosition ?? handle.byte_position ?? 0),
    decodeChunk: (maxFrames) => {
      const value = handle.decode_chunk(Math.max(1, maxFrames));
      return value instanceof Float32Array ? value : new Float32Array(value);
    },
    seekMs: (targetMs) => handle.seek_ms(Math.max(0, targetMs)),
    close: () => handle.free?.(),
  };
}

/** @deprecated Whole-file helper. Production playback must use `openStreamingSource`. */
export function openStreaming(bytes: Uint8Array): AudioStreamingDecoder {
  if (!wasm) throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM is not initialized');
  return wrapStreamingHandle(wasm.open_streaming(bytes));
}

export function openStreamingSource(host: WasmRangeHost, hintExt = ''): AudioStreamingDecoder {
  if (!wasm) throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM is not initialized');
  const open = wasm.openStreamingSource ?? wasm.open_streaming_source;
  if (!open) {
    throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM range decoder is not available');
  }
  return wrapStreamingHandle(open(host, hintExt));
}

let wasm: AudioCoreWasm | null = null;
let wasmFailed = false;

export async function initAudioCore(): Promise<boolean> {
  if (wasm) return true;
  if (wasmFailed) return false;
  try {
    const specifier = '../pkg/nnpm_audio_core.js';
    const mod = (await import(/* @vite-ignore */ specifier)) as unknown as AudioCoreWasm;
    await mod.default();
    wasm = mod;
    return true;
  } catch {
    wasmFailed = true;
    return false;
  }
}

export function audioCoreReady(): boolean {
  return wasm !== null;
}

export function decodeAudio(bytes: Uint8Array): DecodedAudio {
  if (!wasm) {
    throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM is not initialized');
  }
  const decoded = wasm.decode_audio(bytes);
  try {
    const samples = decoded.samples instanceof Float32Array
      ? decoded.samples
      : new Float32Array(decoded.samples);
    return {
      samples,
      channels: decoded.channels,
      sampleRate: decoded.sample_rate,
    };
  } finally {
    decoded.free?.();
  }
}

function u32le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24);
}

function u64le(bytes: Uint8Array, offset: number): number {
  const lo = u32le(bytes, offset) >>> 0;
  const hi = u32le(bytes, offset + 4) >>> 0;
  return hi * 0x1_0000_0000 + lo;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function u64be(bytes: Uint8Array, offset: number): number {
  return u32be(bytes, offset) * 0x1_0000_0000 + u32be(bytes, offset + 4);
}

export function dsdRateFromSampleRate(sampleRate: number): number {
  const candidates = [64, 128, 256, 512, 1024];
  for (const rate of candidates) {
    if (sampleRate === 44_100 * rate || sampleRate === 48_000 * rate) return rate;
  }
  throw new DsdDecodeError('INVALID_CONTAINER', `unsupported DSD sample rate ${sampleRate} Hz`);
}

export function dsdPcmDecimation(dsdRate: number): number {
  if (dsdRate <= 128) return 16;
  if (dsdRate <= 256) return 32;
  if (dsdRate <= 512) return 64;
  return 128;
}

/** Packed DSD bytes per decode tick (~80 ms, 64–256 KiB). */
export function dsdDecodeBlockBytes(dsdSampleRate: number, channels: number): number {
  const bytesPerSec = Math.floor((dsdSampleRate * Math.max(1, channels)) / 8);
  return Math.min(256 * 1024, Math.max(64 * 1024, Math.floor((bytesPerSec * 80) / 1000)));
}

/** 44.1-family FIR rate (DSD64 → 176.4 kHz). */
export function dsdPcmOutputRate(dsdRate: number): number {
  return Math.floor((44_100 * dsdRate) / dsdPcmDecimation(dsdRate));
}

/** FIR PCM rate for a concrete DSD bit clock (44.1 or 48 kHz family). */
export function dsdPcmOutputRateFromHz(dsdSampleRate: number): number {
  return Math.floor(dsdSampleRate / dsdPcmDecimation(dsdRateFromSampleRate(dsdSampleRate)));
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function parseDsdHeader(bytes: Uint8Array, fileLength: number): DsdHeader {
  if (wasm) {
    return wasm.parse_dsd_header_json(bytes);
  }
  if (bytes.length < 4) {
    throw new DsdDecodeError('INVALID_CONTAINER', 'DSD header is truncated');
  }
  const magic = ascii(bytes, 0, 4);
  if (magic === 'DSD ') return parseDsf(bytes, fileLength);
  if (magic === 'FRM8') return parseDff(bytes, fileLength);
  throw new DsdDecodeError('INVALID_CONTAINER', 'missing DSF/DFF signature');
}

function dstStatusFor(rate: number, encoding: DsdEncoding): DstStatus {
  if (encoding !== 'dst') return 'none';
  if (rate === 64) return 'stable';
  if (rate === 128 || rate === 256) return 'experimental';
  return 'unsupported';
}

function parseDsf(bytes: Uint8Array, _fileLength: number): DsdHeader {
  if (bytes.length < 80) {
    throw new DsdDecodeError('INVALID_CONTAINER', 'DSF header is truncated');
  }
  if (u64le(bytes, 4) !== 28) {
    throw new DsdDecodeError('INVALID_CONTAINER', 'DSD header size must be 28 bytes');
  }
  if (ascii(bytes, 28, 4) !== 'fmt ' || u64le(bytes, 32) !== 52) {
    throw new DsdDecodeError('INVALID_CONTAINER', 'fmt chunk is missing or has an invalid size');
  }
  const channels = u32le(bytes, 52);
  const dsdSampleRate = u32le(bytes, 56);
  const bitsPerSample = u32le(bytes, 60);
  const sampleCount = u64le(bytes, 64);
  const blockSize = u32le(bytes, 72);
  if (channels < 1 || channels > 32 || (bitsPerSample !== 1 && bitsPerSample !== 8) || blockSize === 0) {
    throw new DsdDecodeError('INVALID_CONTAINER', 'invalid DSF format fields');
  }
  if (ascii(bytes, 80, 4) !== 'data') {
    throw new DsdDecodeError('INVALID_CONTAINER', 'data chunk is missing after fmt');
  }
  const dataChunkSize = u64le(bytes, 84);
  const dataSize = dataChunkSize - 12;
  const dataOffset = 92;
  const dsdRate = dsdRateFromSampleRate(dsdSampleRate);
  const pcmSampleRate = Math.floor(dsdSampleRate / 8);
  return {
    container: 'dsf',
    encoding: 'raw',
    dsdSampleRate,
    pcmSampleRate,
    outputSampleRate: dsdPcmOutputRateFromHz(dsdSampleRate),
    dsdRate,
    channels,
    sampleCount,
    durationMs: Math.round((sampleCount * 1000) / dsdSampleRate),
    dataOffset,
    dataSize,
    blockSize,
    lsbFirst: bitsPerSample === 1,
    dstStatus: 'none',
  };
}

function scanFrte(bytes: Uint8Array, start: number, end: number): { count?: number; rate?: number } {
  let offset = start;
  let count: number | undefined;
  let rate: number | undefined;
  while (offset + 12 <= bytes.length && offset + 12 <= end) {
    const id = ascii(bytes, offset, 4);
    const size = u64be(bytes, offset + 4);
    const body = offset + 12;
    if (id === 'FRTE' && body + 6 <= bytes.length && body + 6 <= end) {
      count = u32be(bytes, body);
      rate = (bytes[body + 4]! << 8) | bytes[body + 5]!;
    }
    offset = body + Number(size) + (Number(size) % 2);
  }
  return { count, rate };
}

function parseDff(bytes: Uint8Array, _fileLength: number): DsdHeader {
  if (bytes.length < 16 || ascii(bytes, 12, 4) !== 'DSD ') {
    throw new DsdDecodeError('INVALID_CONTAINER', 'DFF FRM8 is not a DSD form');
  }
  let offset = 16;
  let channels = 2;
  let dsdSampleRate = 2_822_400;
  let dataOffset = 0;
  let dataSize = 0;
  let encoding: DsdEncoding = 'raw';
  let dstFrameCount: number | undefined;
  let dstFrameRate: number | undefined;
  while (offset + 12 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = u64be(bytes, offset + 4);
    const body = offset + 12;
    if (id === 'PROP') {
      // nested chunks parsed loosely below
    } else if (id === 'FS  ' && body + 4 <= bytes.length) {
      dsdSampleRate = u32be(bytes, body);
    } else if (id === 'CHNL' && body + 2 <= bytes.length) {
      channels = (bytes[body]! << 8) | bytes[body + 1]!;
    } else if (id === 'CMPR' && body + 4 <= bytes.length) {
      const compression = ascii(bytes, body, 4);
      if (compression === 'DST ') encoding = 'dst';
    } else if (id === 'FRTE' && body + 6 <= bytes.length) {
      dstFrameCount = u32be(bytes, body);
      dstFrameRate = (bytes[body + 4]! << 8) | bytes[body + 5]!;
    } else if (id === 'DSD ' || id === 'DST ') {
      if (id === 'DST ') {
        encoding = 'dst';
        const inner = scanFrte(bytes, body, body + Number(size));
        dstFrameCount = inner.count ?? dstFrameCount;
        dstFrameRate = inner.rate ?? dstFrameRate;
      }
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + Number(size) + (Number(size) % 2);
  }
  if (dataOffset === 0) {
    throw new DsdDecodeError('INVALID_CONTAINER', 'DFF data chunk is missing');
  }
  const dsdRate = dsdRateFromSampleRate(dsdSampleRate);
  const pcmSampleRate = Math.floor(dsdSampleRate / 8);
  const sampleCount = encoding === 'dst' && dstFrameCount && dstFrameRate
    ? Math.floor((dstFrameCount * dsdSampleRate) / dstFrameRate)
    : Math.floor((dataSize * 8) / Math.max(channels, 1));
  const dst = dstStatusFor(dsdRate, encoding);
  return {
    container: 'dff',
    encoding,
    dsdSampleRate,
    pcmSampleRate,
    outputSampleRate: dsdPcmOutputRateFromHz(dsdSampleRate),
    dsdRate,
    channels,
    sampleCount,
    durationMs: Math.round((sampleCount * 1000) / dsdSampleRate),
    dataOffset,
    dataSize,
    blockSize: 4096,
    lsbFirst: false,
    dstStatus: dst,
  };
}

/** DSF block-planar `[ch0 block][ch1 block]…` → channel-byte-interleaved. */
export function deinterleaveDsfPlanar(
  physical: Uint8Array,
  channels: number,
  blockSize: number,
  consumedPerChannel = 0,
  bytesPerChannel = Number.POSITIVE_INFINITY,
): Uint8Array {
  const ch = Math.max(1, channels);
  const block = Math.max(1, blockSize);
  const physicalBlock = block * ch;
  if (physicalBlock === 0 || physical.length < physicalBlock) {
    return new Uint8Array();
  }
  const blocks = Math.floor(physical.length / physicalBlock);
  const out = new Uint8Array(blocks * Math.min(block, bytesPerChannel) * ch);
  let written = 0;
  let consumed = consumedPerChannel;
  for (let index = 0; index < blocks; index += 1) {
    const base = index * physicalBlock;
    const channelBytes = Math.min(block, Math.max(0, bytesPerChannel - consumed));
    for (let byteIndex = 0; byteIndex < channelBytes; byteIndex += 1) {
      for (let channel = 0; channel < ch; channel += 1) {
        out[written] = physical[base + channel * block + byteIndex]!;
        written += 1;
      }
    }
    consumed += block;
  }
  return written === out.length ? out : out.subarray(0, written);
}

export interface DsdPcmPushStream {
  push(bytes: Uint8Array): Float32Array;
  flush(): Float32Array;
}

export interface DsdPcmOptions {
  /** Test-only first-stage JS FIR. Production playback must use WASM. */
  allowJsFallback?: boolean;
}

/** Streaming DSD→PCM. Keeps FIR look-ahead across range chunks. */
export function createDsdPcmStream(
  channels: number,
  lsbFirst: boolean,
  dsdSampleRate = 2_822_400,
  options?: DsdPcmOptions,
): DsdPcmPushStream {
  if (wasm?.DsdPcmStream) {
    const stream = new wasm.DsdPcmStream(channels, lsbFirst, dsdSampleRate);
    return {
      push: bytes => {
        const samples = stream.push(bytes);
        return samples instanceof Float32Array ? samples : new Float32Array(samples);
      },
      flush: () => {
        const samples = stream.flush();
        stream.free?.();
        return samples instanceof Float32Array ? samples : new Float32Array(samples);
      },
    };
  }
  if (!options?.allowJsFallback) {
    throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM FIR is required');
  }
  const ch = Math.max(1, channels);
  const target = dsdPcmOutputRateFromHz(dsdSampleRate);
  const bytesPerOut = Math.max(1, Math.floor(dsdSampleRate / target / 8));
  const frameBytes = bytesPerOut * ch;
  let pending = new Uint8Array(0);
  return {
    push(bytes) {
      const merged = new Uint8Array(pending.length + bytes.length);
      merged.set(pending);
      merged.set(bytes, pending.length);
      const complete = merged.length - (merged.length % frameBytes);
      pending = merged.subarray(complete);
      return firstStageFir(merged.subarray(0, complete), channels, lsbFirst, dsdSampleRate);
    },
    flush() {
      const samples = firstStageFir(pending, channels, lsbFirst, dsdSampleRate);
      pending = new Uint8Array(0);
      return samples;
    },
  };
}

/** Compact DSD→PCM. Production uses the Rust WASM FIR only. */
export function dsdBytesToPcm(
  bytes: Uint8Array,
  channels: number,
  lsbFirst: boolean,
  dsdSampleRate = 2_822_400,
  options?: DsdPcmOptions,
): Float32Array {
  if (wasm) {
    const samples = wasm.dsd_payload_to_pcm_f32(bytes, channels, lsbFirst, dsdSampleRate);
    return samples instanceof Float32Array ? samples : new Float32Array(samples);
  }
  if (!options?.allowJsFallback) {
    throw new DsdDecodeError('UNSUPPORTED_FORMAT', 'nnpm-audio-core WASM FIR is required');
  }
  return firstStageFir(bytes, channels, lsbFirst, dsdSampleRate);
}

function firstStageFir(
  bytes: Uint8Array,
  channels: number,
  lsbFirst: boolean,
  dsdSampleRate: number,
): Float32Array {
  const ch = Math.max(1, channels);
  const target = dsdPcmOutputRateFromHz(dsdSampleRate);
  const decimation = Math.max(8, Math.floor(dsdSampleRate / target));
  const bytesPerOut = Math.max(1, Math.floor(decimation / 8));
  const aligned = bytes.length - (bytes.length % ch);
  const byteFrames = aligned / ch;
  const outFrames = Math.floor(byteFrames / bytesPerOut);
  const out = new Float32Array(outFrames * ch);
  for (let frame = 0; frame < outFrames; frame += 1) {
    for (let channel = 0; channel < ch; channel += 1) {
      let sum = 0;
      let bits = 0;
      for (let byteIndex = 0; byteIndex < bytesPerOut; byteIndex += 1) {
        let value = bytes[(frame * bytesPerOut + byteIndex) * ch + channel]!;
        if (lsbFirst) {
          value = reverseBits(value);
        }
        for (let bit = 7; bit >= 0; bit -= 1) {
          sum += ((value >> bit) & 1) === 1 ? 1 : -1;
          bits += 1;
        }
      }
      out[frame * ch + channel] = (sum / bits) * 0.5;
    }
  }
  return out;
}

function reverseBits(value: number): number {
  let x = value;
  x = ((x & 0xf0) >> 4) | ((x & 0x0f) << 4);
  x = ((x & 0xcc) >> 2) | ((x & 0x33) << 2);
  x = ((x & 0xaa) >> 1) | ((x & 0x55) << 1);
  return x;
}

export function createMinimalDsf(options?: {
  channels?: number;
  dsdSampleRate?: number;
  blockSize?: number;
  sampleCount?: number;
}): Uint8Array {
  const channels = options?.channels ?? 2;
  const dsdSampleRate = options?.dsdSampleRate ?? 2_822_400;
  const blockSize = options?.blockSize ?? 8;
  const sampleCount = options?.sampleCount ?? 64;
  const bytesPerChannel = Math.ceil(sampleCount / 8);
  const blocks = Math.ceil(bytesPerChannel / blockSize);
  const dataSize = blocks * blockSize * channels;
  const body = new Uint8Array(92 + dataSize);
  const view = new DataView(body.buffer);
  body.set([0x44, 0x53, 0x44, 0x20], 0);
  view.setBigUint64(4, 28n, true);
  view.setBigUint64(12, BigInt(body.length), true);
  view.setBigUint64(20, 0n, true);
  body.set([0x66, 0x6d, 0x74, 0x20], 28);
  view.setBigUint64(32, 52n, true);
  view.setUint32(40, 1, true);
  view.setUint32(44, 0, true);
  view.setUint32(48, 2, true);
  view.setUint32(52, channels, true);
  view.setUint32(56, dsdSampleRate, true);
  view.setUint32(60, 8, true);
  view.setBigUint64(64, BigInt(sampleCount), true);
  view.setUint32(72, blockSize, true);
  view.setUint32(76, 0, true);
  body.set([0x64, 0x61, 0x74, 0x61], 80);
  view.setBigUint64(84, BigInt(dataSize + 12), true);
  body.fill(0x69, 92);
  return body;
}

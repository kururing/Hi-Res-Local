export const STREAM_QUALITIES = [
  'maximum',
  'original',
  'hires',
  'lossless',
  'compatible',
  'data-saver',
  'auto',
  'high',
  'max',
] as const;

export type StreamQuality = (typeof STREAM_QUALITIES)[number];
export type QualityPreset = StreamQuality;

export const DEFAULT_STREAM_QUALITY: StreamQuality = 'maximum';

export function isStreamQuality(value: unknown): value is StreamQuality {
  return typeof value === 'string' && (STREAM_QUALITIES as readonly string[]).includes(value);
}

/** Streaming always uses the highest-fidelity original object stored in MinIO. */
export function normalizeStreamingQuality(_value: unknown): StreamQuality {
  return DEFAULT_STREAM_QUALITY;
}

export function canonicalQuality(quality: QualityPreset): QualityPreset {
  if (quality === 'max' || quality === 'original') return 'maximum';
  if (quality === 'high') return 'compatible';
  return quality;
}

export interface BrowserFormatCapability {
  codec: string;
  container: string;
  mimeType: string;
  confidence: 'maybe' | 'probably';
}

export interface StreamRequest {
  quality: StreamQuality;
  supportedFormats: BrowserFormatCapability[];
}

export interface StreamAsset {
  codec: string;
  container: string;
  mimeType?: string;
  sampleRateHz: number;
  bitDepth: number | null;
  channels: number;
  bitrateKbps: number | null;
  lossless: boolean;
  fileSizeBytes?: number;
  durationMs?: number;
  hires?: boolean;
  isDsd?: boolean;
  dsdRate?: number | null;
  supportsRange?: boolean;
  streamMode?: StreamQuality;
}

export interface StreamDescriptor {
  url: string;
  expiresAt: string;
  asset: StreamAsset;
}

export interface AudioSourceInfo {
  trackId: string;
  codec: string;
  container: string;
  channels: number;
  sampleRate: number;
  bitDepth: number | null;
  bitrate: number | null;
  dsdRate: number | null;
  durationMs: number;
  fileSize: number;
  lossless: boolean;
  hires: boolean;
  streamMode: StreamQuality;
  supportsRange: true;
  streamUrl?: string;
  expiresAt?: string;
}

export interface StreamingApi {
  createStream(
    trackId: string,
    request: StreamRequest,
    signal?: AbortSignal,
  ): Promise<StreamDescriptor>;
  getSource?(
    trackId: string,
    quality?: StreamQuality,
    signal?: AbortSignal,
  ): Promise<AudioSourceInfo>;
}

const DSD_CODECS = new Set(['dsd', 'dsd_lsbf', 'dsd_msbf', 'dsd_lsbf_planar', 'dst']);
const DSD_CONTAINERS = new Set(['dsf', 'dff']);

export function isDsdFormat(codec: string, container: string): boolean {
  const c = codec.trim().toLowerCase();
  const k = container.trim().toLowerCase();
  return DSD_CODECS.has(c) || DSD_CONTAINERS.has(k) || c.startsWith('dsd');
}

export function dsdRateFromSampleRateHz(sampleRateHz: number): number | null {
  const candidates: Array<[number, number]> = [
    [64, 64],
    [128, 128],
    [256, 256],
    [512, 512],
    [1024, 1024],
  ];
  for (const [multiplier, rate] of candidates) {
    if (sampleRateHz === 44_100 * multiplier || sampleRateHz === 48_000 * multiplier) {
      return rate;
    }
  }
  return null;
}

export function isHiResAsset(input: {
  codec: string;
  container: string;
  sampleRateHz: number;
  bitDepth: number | null;
  lossless: boolean;
}): boolean {
  if (isDsdFormat(input.codec, input.container)) return true;
  return input.lossless && (input.sampleRateHz > 48_000 || (input.bitDepth ?? 0) > 16);
}

import { CloudApiClient } from '../../api/client';
import type {
  AudioSourceInfo,
  StreamDescriptor,
  StreamRequest,
  StreamingApi,
} from './types';

interface StreamAssetPayload {
  codec?: unknown;
  container?: unknown;
  mime_type?: unknown;
  sample_rate_hz?: unknown;
  bit_depth?: unknown;
  channels?: unknown;
  bitrate_kbps?: unknown;
  lossless?: unknown;
  file_size_bytes?: unknown;
  duration_ms?: unknown;
  hi_res?: unknown;
  is_dsd?: unknown;
  dsd_rate?: unknown;
  supports_range?: unknown;
  stream_mode?: unknown;
}

interface StreamPayload {
  url?: unknown;
  expires_at?: unknown;
  asset?: StreamAssetPayload;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Stream response field "${field}" is invalid.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Stream response field "${field}" is invalid.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Stream response field "${field}" is invalid.`);
  }
  return value;
}

export function parseSourceInfo(payload: unknown): AudioSourceInfo {
  if (typeof payload !== 'object' || payload == null) {
    throw new Error('Source response was not an object.');
  }
  const body = payload as {
    track_id?: unknown;
    codec?: unknown;
    container?: unknown;
    channels?: unknown;
    sample_rate?: unknown;
    bit_depth?: unknown;
    bitrate?: unknown;
    dsd_rate?: unknown;
    duration_ms?: unknown;
    file_size?: unknown;
    lossless?: unknown;
    hires?: unknown;
    stream_mode?: unknown;
    supports_range?: unknown;
  };
  if (body.lossless !== true && body.lossless !== false) {
    throw new Error('Source response field "lossless" is invalid.');
  }
  if (body.hires !== true && body.hires !== false) {
    throw new Error('Source response field "hires" is invalid.');
  }
  if (body.supports_range !== true) {
    throw new Error('Source response field "supports_range" is invalid.');
  }
  return {
    trackId: requireString(body.track_id, 'track_id'),
    codec: requireString(body.codec, 'codec'),
    container: requireString(body.container, 'container'),
    channels: requireNumber(body.channels, 'channels'),
    sampleRate: requireNumber(body.sample_rate, 'sample_rate'),
    bitDepth: optionalNumber(body.bit_depth, 'bit_depth'),
    bitrate: optionalNumber(body.bitrate, 'bitrate'),
    dsdRate: optionalNumber(body.dsd_rate, 'dsd_rate'),
    durationMs: requireNumber(body.duration_ms, 'duration_ms'),
    fileSize: requireNumber(body.file_size, 'file_size'),
    lossless: body.lossless,
    hires: body.hires,
    streamMode: typeof body.stream_mode === 'string'
      ? body.stream_mode as AudioSourceInfo['streamMode']
      : 'original',
    supportsRange: true,
  };
}

export function parseStreamDescriptor(payload: unknown): StreamDescriptor {
  if (typeof payload !== 'object' || payload == null) {
    throw new Error('Stream response was not an object.');
  }

  const body = payload as StreamPayload;
  const url = requireString(body.url, 'url');
  const expiresAt = requireString(body.expires_at, 'expires_at');
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error('Stream response field "expires_at" is not a valid date.');
  }

  const asset = body.asset;
  if (typeof asset !== 'object' || asset == null) {
    throw new Error('Stream response field "asset" is invalid.');
  }

  const mimeType = asset.mime_type == null ? undefined : requireString(asset.mime_type, 'asset.mime_type');

  return {
    url,
    expiresAt,
    asset: {
      codec: requireString(asset.codec, 'asset.codec'),
      container: requireString(asset.container, 'asset.container'),
      mimeType,
      sampleRateHz: requireNumber(asset.sample_rate_hz, 'asset.sample_rate_hz'),
      bitDepth: optionalNumber(asset.bit_depth, 'asset.bit_depth'),
      channels: requireNumber(asset.channels, 'asset.channels'),
      bitrateKbps: optionalNumber(asset.bitrate_kbps, 'asset.bitrate_kbps'),
      lossless: typeof asset.lossless === 'boolean'
        ? asset.lossless
        : (() => {
          throw new Error('Stream response field "asset.lossless" is invalid.');
        })(),
      fileSizeBytes: optionalNumber(asset.file_size_bytes, 'asset.file_size_bytes') ?? undefined,
      durationMs: optionalNumber(asset.duration_ms, 'asset.duration_ms') ?? undefined,
      hires: typeof asset.hi_res === 'boolean' ? asset.hi_res : undefined,
      isDsd: typeof asset.is_dsd === 'boolean' ? asset.is_dsd : undefined,
      dsdRate: optionalNumber(asset.dsd_rate, 'asset.dsd_rate'),
      supportsRange: asset.supports_range === true,
      streamMode: typeof asset.stream_mode === 'string' ? asset.stream_mode as StreamDescriptor['asset']['streamMode'] : undefined,
    },
  };
}

/**
 * Browser-only adapter. Signed URLs stay in memory on the returned descriptor
 * and are never written to storage or logged.
 */
export class WebStreamingApi implements StreamingApi {
  constructor(private readonly cloud: CloudApiClient) {}

  async createStream(
    trackId: string,
    request: StreamRequest,
    signal?: AbortSignal
  ): Promise<StreamDescriptor> {
    const payload = await this.cloud.request<unknown>(`/v1/tracks/${trackId}/stream`, {
      method: 'POST',
      signal,
      body: {
        quality: request.quality,
        supported_formats: request.supportedFormats.map(format => ({
          codec: format.codec,
          container: format.container,
          mime_type: format.mimeType,
        })),
      },
    });
    return parseStreamDescriptor(payload);
  }

  async getSource(
    trackId: string,
    quality?: StreamRequest['quality'],
    signal?: AbortSignal,
  ): Promise<AudioSourceInfo> {
    const query = quality ? `?quality=${encodeURIComponent(quality)}` : '';
    const payload = await this.cloud.request<unknown>(`/v1/tracks/${trackId}/source${query}`, { signal });
    return parseSourceInfo(payload);
  }
}

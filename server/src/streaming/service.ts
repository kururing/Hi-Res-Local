import type { AppConfig } from '../config/env.js';
import { CatalogRepository } from '../catalog/repository.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import type { ObjectStorageSigner } from '../storage/signer.js';
import {
  assetClassification,
  canonicalQuality,
  ClientFormatUnsupportedError,
  QualityUnavailableError,
  selectAudioAsset,
  type QualityPreset,
  type SelectableAsset,
  type SupportedFormatHint,
} from './assetSelector.js';
import { audioMimeType } from './mime.js';

export interface StreamRequest {
  quality?: QualityPreset;
  supported_formats?: SupportedFormatHint[];
}

export interface StreamAssetView {
  codec: string;
  container: string;
  mime_type?: string;
  sample_rate_hz: number;
  bit_depth: number | null;
  channels: number;
  bitrate_kbps: number | null;
  lossless: boolean;
  file_size_bytes: number;
  duration_ms: number;
  hi_res: boolean;
  is_dsd: boolean;
  dsd_rate: number | null;
  supports_range: true;
  stream_mode: QualityPreset;
}

export interface StreamResponse {
  url: string;
  expires_at: string;
  asset: StreamAssetView;
  track_id: string;
}

export interface SourceResponse {
  track_id: string;
  codec: string;
  container: string;
  channels: number;
  sample_rate: number;
  bit_depth: number | null;
  bitrate: number | null;
  dsd_rate: number | null;
  duration_ms: number;
  file_size: number;
  lossless: boolean;
  hires: boolean;
  stream_mode: QualityPreset;
  supports_range: true;
}

function assertPublished(record: Awaited<ReturnType<CatalogRepository['getTrackRecord']>>) {
  if (
    !record
    || record.deletedAt
    || record.publicationState !== 'published'
    || !record.available
  ) {
    throw new AppError(404, ErrorCodes.STREAM_TRACK_UNAVAILABLE, 'Track is unavailable.');
  }
  return record;
}

function selectOrThrow(
  assets: SelectableAsset[],
  quality: QualityPreset,
  supportedFormats?: SupportedFormatHint[],
): SelectableAsset {
  const availableAssets = assets.filter((asset) => asset.available);
  if (availableAssets.length === 0) {
    throw new AppError(404, ErrorCodes.STREAM_ASSET_UNAVAILABLE, 'No audio asset is available.');
  }
  try {
    return selectAudioAsset(assets, quality, supportedFormats);
  } catch (error) {
    if (error instanceof ClientFormatUnsupportedError) {
      throw new AppError(
        409,
        ErrorCodes.STREAM_FORMAT_UNSUPPORTED,
        'No audio asset is compatible with this client.',
      );
    }
    if (error instanceof QualityUnavailableError) {
      throw new AppError(
        409,
        ErrorCodes.STREAM_QUALITY_UNAVAILABLE,
        `No audio asset matches quality "${quality}".`,
      );
    }
    throw error;
  }
}

function toAssetView(selected: SelectableAsset, quality: QualityPreset): StreamAssetView {
  const info = assetClassification(selected);
  const mimeType = audioMimeType(selected.codec, selected.container);
  return {
    codec: selected.codec,
    container: selected.container,
    ...(mimeType ? { mime_type: mimeType } : {}),
    sample_rate_hz: selected.sampleRateHz,
    bit_depth: selected.bitDepth,
    channels: selected.channels,
    bitrate_kbps: selected.bitrateKbps,
    lossless: selected.isLossless,
    file_size_bytes: selected.fileSizeBytes ?? 0,
    duration_ms: Math.round(selected.durationSeconds * 1000),
    hi_res: info.hiRes,
    is_dsd: info.isDsd,
    dsd_rate: info.dsdRate,
    supports_range: true,
    stream_mode: canonicalQuality(quality),
  };
}

export class StreamingService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly signer: ObjectStorageSigner,
    private readonly config: AppConfig,
  ) {}

  async createStream(trackId: string, _input: StreamRequest): Promise<StreamResponse> {
    const quality: QualityPreset = 'maximum';
    const record = assertPublished(await this.catalog.getTrackRecord(trackId));
    const selected = selectOrThrow(record.assets, quality);
    const asset = toAssetView(selected, quality);
    const signed = await this.signer.createReadUrl(
      selected.storageKey,
      this.config.signedUrlTtlSeconds,
      asset.mime_type ? { contentType: asset.mime_type } : undefined,
    );

    return {
      url: signed.url,
      expires_at: signed.expiresAt.toISOString(),
      track_id: trackId,
      asset,
    };
  }

  async getSource(trackId: string, _input: StreamRequest): Promise<SourceResponse> {
    const quality: QualityPreset = 'maximum';
    const record = assertPublished(await this.catalog.getTrackRecord(trackId));
    const selected = selectOrThrow(record.assets, quality);
    const asset = toAssetView(selected, quality);
    return {
      track_id: trackId,
      codec: asset.codec,
      container: asset.container,
      channels: asset.channels,
      sample_rate: asset.sample_rate_hz,
      bit_depth: asset.bit_depth,
      bitrate: asset.bitrate_kbps,
      dsd_rate: asset.dsd_rate,
      duration_ms: asset.duration_ms,
      file_size: asset.file_size_bytes,
      lossless: asset.lossless,
      hires: asset.hi_res,
      stream_mode: asset.stream_mode,
      supports_range: true,
    };
  }

  async getArtworkUrl(trackId: string): Promise<string> {
    const record = await this.catalog.getTrackRecord(trackId);
    if (!record || record.deletedAt || record.publicationState !== 'published') {
      throw new AppError(404, ErrorCodes.TRACK_NOT_FOUND, 'Track not found.');
    }
    const url = record.track.cover_art_path?.trim();
    if (!url) {
      throw new AppError(404, ErrorCodes.SOURCE_NOT_FOUND, 'Artwork is not available for this track.');
    }
    return url;
  }
}

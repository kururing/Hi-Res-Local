import { formatsCompatible, type FormatHint } from './mime.js';
import { classifyAudio } from '../ingestion/classification.js';

export type QualityPreset =
  | 'auto'
  | 'high'
  | 'lossless'
  | 'max'
  | 'maximum'
  | 'original'
  | 'hires'
  | 'compatible'
  | 'data-saver';

export type SupportedFormatHint = FormatHint;

export interface SelectableAsset {
  id: string;
  storageKey: string;
  container: string;
  codec: string;
  sampleRateHz: number;
  bitDepth: number | null;
  channels: number;
  bitrateKbps: number | null;
  durationSeconds: number;
  fileSizeBytes?: number;
  isLossless: boolean;
  hiRes?: boolean;
  isDsd?: boolean;
  dsdRate?: number | null;
  isMqa?: boolean;
  mqaStatus?: string | null;
  replaygainTrackGain?: number | null;
  replaygainTrackPeak?: number | null;
  replaygainAlbumGain?: number | null;
  replaygainAlbumPeak?: number | null;
  available: boolean;
}

export class QualityUnavailableError extends Error {
  readonly quality: QualityPreset;

  constructor(quality: QualityPreset) {
    super(`No audio asset matches quality "${quality}".`);
    this.name = 'QualityUnavailableError';
    this.quality = quality;
  }
}

export class ClientFormatUnsupportedError extends Error {
  constructor() {
    super('No audio asset is compatible with the client.');
    this.name = 'ClientFormatUnsupportedError';
  }
}

const HIGH_LOSSY_MIN_BITRATE_KBPS = 256;
const STANDARD_MAX_SAMPLE_RATE_HZ = 48_000;
const CD_MAX_BIT_DEPTH = 16;

export function canonicalQuality(quality: QualityPreset): QualityPreset {
  if (quality === 'max' || quality === 'original') return 'maximum';
  if (quality === 'high') return 'compatible';
  return quality;
}

export function assetClassification(asset: SelectableAsset) {
  const classified = classifyAudio({
    codec: asset.codec,
    container: asset.container,
    sampleRateHz: asset.sampleRateHz,
    bitDepth: asset.bitDepth,
    isLossless: asset.isLossless,
  });
  return {
    lossless: asset.isLossless,
    hiRes: classified.hiRes || Boolean(asset.hiRes),
    isDsd: classified.dsd || Boolean(asset.isDsd),
    dsdRate: classified.dsdRate ?? asset.dsdRate ?? null,
  };
}

/**
 * Ranking used by `maximum` (and its legacy aliases) and as a tie-breaker.
 * Lossless always outranks lossy. Among equals, higher sample rate, bit depth,
 * channel count, then bitrate wins. Original asset parameters are never altered.
 */
export function fidelityScore(asset: SelectableAsset): number {
  const lossless = asset.isLossless ? 1e15 : 0;
  const depth = asset.bitDepth ?? (asset.isLossless ? 16 : 0);
  const bitrate = asset.bitrateKbps ?? 0;
  return lossless
    + asset.sampleRateHz * Math.max(depth, 1) * asset.channels
    + bitrate;
}

function availableOf(assets: SelectableAsset[]): SelectableAsset[] {
  return assets.filter((asset) => asset.available);
}

export function compatibleAssets(
  assets: SelectableAsset[],
  supportedFormats?: SupportedFormatHint[],
): SelectableAsset[] {
  const available = availableOf(assets);
  if (!supportedFormats || supportedFormats.length === 0) {
    return available;
  }
  return available.filter((asset) =>
    supportedFormats.some((hint) => formatsCompatible(asset, hint)),
  );
}

function bestByScore(assets: SelectableAsset[]): SelectableAsset | undefined {
  return assets.reduce<SelectableAsset | undefined>((best, asset) => {
    if (!best || fidelityScore(asset) > fidelityScore(best)) return asset;
    return best;
  }, undefined);
}

function bestLossyBitrate(assets: SelectableAsset[]): SelectableAsset | undefined {
  return assets.reduce<SelectableAsset | undefined>((best, asset) => {
    const bitrate = asset.bitrateKbps ?? 0;
    const bestBitrate = best?.bitrateKbps ?? -1;
    if (bitrate > bestBitrate) return asset;
    if (bitrate === bestBitrate && best && fidelityScore(asset) > fidelityScore(best)) return asset;
    return best;
  }, undefined);
}

function lowestLossyBitrate(assets: SelectableAsset[]): SelectableAsset | undefined {
  return assets.reduce<SelectableAsset | undefined>((best, asset) => {
    const bitrate = asset.bitrateKbps ?? Number.POSITIVE_INFINITY;
    const bestBitrate = best?.bitrateKbps ?? Number.POSITIVE_INFINITY;
    if (bitrate < bestBitrate) return asset;
    if (bitrate === bestBitrate && best && fidelityScore(asset) < fidelityScore(best)) return asset;
    return best;
  }, undefined);
}

function selectHigh(pool: SelectableAsset[]): SelectableAsset | undefined {
  const highLossy = pool.filter(
    (asset) => !asset.isLossless && (asset.bitrateKbps ?? 0) >= HIGH_LOSSY_MIN_BITRATE_KBPS,
  );
  const highLossyPick = bestLossyBitrate(highLossy);
  if (highLossyPick) return highLossyPick;

  const cdLossless = pool.filter(
    (asset) =>
      asset.isLossless
      && asset.sampleRateHz <= STANDARD_MAX_SAMPLE_RATE_HZ
      && (asset.bitDepth ?? 16) <= CD_MAX_BIT_DEPTH,
  );
  return bestByScore(cdLossless);
}

function selectAuto(pool: SelectableAsset[]): SelectableAsset | undefined {
  const standardLossless = pool.filter(
    (asset) => asset.isLossless && asset.sampleRateHz <= STANDARD_MAX_SAMPLE_RATE_HZ,
  );
  const standardPick = bestByScore(standardLossless);
  if (standardPick) return standardPick;

  const lossy = pool.filter((asset) => !asset.isLossless);
  const lossyPick = bestLossyBitrate(lossy);
  if (lossyPick) return lossyPick;

  return bestByScore(pool);
}

/**
 * Asset selection policy (no transcode, no silent quality downgrade except `auto`):
 *
 * - `maximum`/`original`/`max`: highest fidelityScore among available assets.
 * - `hires`: lossless hi-res or DSD; errors if none.
 * - `lossless`: only `is_lossless` assets; then max fidelity. Errors if none.
 * - `compatible`/`high`: high-bitrate lossy (>= 256 kbps) OR CD lossless.
 * - `data-saver`: lowest-bitrate existing lossy asset. Errors if none (no transcode).
 * - `auto`: prefer lossless at <= 48 kHz, else highest-bitrate lossy, else original.
 */
export function selectAudioAsset(
  assets: SelectableAsset[],
  quality: QualityPreset,
  supportedFormats?: SupportedFormatHint[],
): SelectableAsset {
  const available = availableOf(assets);
  if (available.length === 0) {
    throw new QualityUnavailableError(quality);
  }

  const mode = canonicalQuality(quality);
  if (mode === 'maximum') {
    const selected = bestByScore(available);
    if (!selected) throw new QualityUnavailableError(quality);
    if (
      supportedFormats
      && supportedFormats.length > 0
      && !supportedFormats.some((hint) => formatsCompatible(selected, hint))
    ) {
      throw new ClientFormatUnsupportedError();
    }
    return selected;
  }

  const candidates = compatibleAssets(assets, supportedFormats);
  if (supportedFormats && supportedFormats.length > 0 && candidates.length === 0) {
    throw new ClientFormatUnsupportedError();
  }

  const pool = candidates;
  if (mode === 'hires') {
    const hires = pool.filter((asset) => {
      const info = assetClassification(asset);
      return asset.isLossless && info.hiRes;
    });
    const selected = bestByScore(hires);
    if (!selected) throw new QualityUnavailableError(quality);
    return selected;
  }

  if (mode === 'lossless') {
    const lossless = pool.filter((asset) => asset.isLossless);
    const selected = bestByScore(lossless);
    if (!selected) throw new QualityUnavailableError(quality);
    return selected;
  }

  if (mode === 'compatible') {
    const selected = selectHigh(pool);
    if (!selected) throw new QualityUnavailableError(quality);
    return selected;
  }

  if (mode === 'data-saver') {
    const lossy = pool.filter((asset) => !asset.isLossless);
    const selected = lowestLossyBitrate(lossy);
    if (!selected) throw new QualityUnavailableError(quality);
    return selected;
  }

  const selected = selectAuto(pool);
  if (!selected) throw new QualityUnavailableError(quality);
  return selected;
}

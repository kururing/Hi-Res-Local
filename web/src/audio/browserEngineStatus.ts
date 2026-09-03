import { dsdRateFromSampleRateHz, isDsdFormat, type StreamDescriptor } from '@nnpm/audio-contracts';
import type { DsdRate, EngineStatus } from '../types/audio';
import type { StreamQuality } from '../platform/streaming/types';
import type { Track } from '../types/library';

export const BROWSER_AUDIO_CORE_MODE = 'nnpm-audio-core';
export const BROWSER_WEB_AUDIO_MODE = 'Web Audio';
/** @deprecated Browser playback uses nnpm-audio-core + Web Audio. */
export const BROWSER_HTML_AUDIO_MODE = BROWSER_AUDIO_CORE_MODE;

const EMPTY_BROWSER_ENGINE_STATUS: EngineStatus = {
  output_mode: '',
  bit_perfect: false,
  is_native: false,
  output_sample_rate: 0,
  output_bit_depth: 0,
  source_label: '',
  source_format: '',
  source_sample_rate: 0,
  source_bit_depth: 0,
  output_format: '',
  volume: 1,
  volume_control_kind: 'software',
};

export function emptyBrowserEngineStatus(volume = 1): EngineStatus {
  return { ...EMPTY_BROWSER_ENGINE_STATUS, volume };
}

export function formatAudioRate(rate?: number | null): string {
  if (!rate || rate <= 0) return '—';
  if (rate >= 1_000_000) {
    const mhz = rate / 1_000_000;
    return `${Number.isInteger(mhz) ? mhz : mhz.toFixed(1)} MHz`;
  }
  const khz = rate / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

export function formatPcmLabel(
  bitDepth: number | null | undefined,
  sampleRate: number | null | undefined,
): string {
  const depth = bitDepth && bitDepth > 0 ? `${bitDepth}-bit` : null;
  const rate = sampleRate && sampleRate > 0 ? formatAudioRate(sampleRate) : null;
  if (depth && rate) return `PCM ${depth} / ${rate}`;
  if (rate) return `PCM ${rate}`;
  if (depth) return `PCM ${depth}`;
  return 'PCM';
}

export function toDsdRateLabel(rate: number | null | undefined): DsdRate | null {
  if (rate === 64 || rate === 128 || rate === 256 || rate === 512 || rate === 1024) {
    return `dsd${rate}` as DsdRate;
  }
  return null;
}

export function buildBrowserEngineStatus(input: {
  track: Track | null;
  descriptor: StreamDescriptor | null;
  volume: number;
  dsd: boolean;
  dsdOutputSampleRate?: number;
  dsdRate?: number | null;
  pcmOutputSampleRate?: number;
  pcmOutputBitDepth?: number;
  quality?: StreamQuality;
}): EngineStatus {
  const asset = input.descriptor?.asset;
  const sourceRate = asset?.sampleRateHz ?? input.track?.sample_rate ?? 0;
  const sourceDepth = asset?.bitDepth ?? input.track?.bit_depth ?? input.track?.bits_per_sample ?? 0;
  const container = (asset?.container || input.track?.format || '').toUpperCase();
  const dsdRate = toDsdRateLabel(
    input.dsdRate
      ?? asset?.dsdRate
      ?? dsdRateFromSampleRateHz(sourceRate),
  );
  const qualityMode = input.quality === 'lossless'
    ? 'lossless'
    : input.quality === 'auto'
      ? 'auto'
      : input.quality === 'compatible' || input.quality === 'high'
        ? 'compatible'
        : input.quality === 'data-saver'
          ? 'data-saver'
          : input.quality === 'hires'
            ? 'hires'
            : 'maximum';

  if (input.dsd) {
    const outputRate = input.dsdOutputSampleRate && input.dsdOutputSampleRate > 0
      ? input.dsdOutputSampleRate
      : 0;
    const sourceLabel = dsdRate ? dsdRate.toUpperCase() : (container || 'DSD');
    return {
      output_mode: BROWSER_WEB_AUDIO_MODE,
      bit_perfect: false,
      is_native: false,
      output_sample_rate: outputRate,
      output_bit_depth: 32,
      source_label: sourceLabel,
      backend: 'shared',
      dsd_output_mode: 'pcm',
      dsd_rate: dsdRate,
      source_format: sourceLabel,
      source_sample_rate: sourceRate,
      source_bit_depth: 1,
      dsd_transport: 'pcm',
      output_format: formatPcmLabel(32, outputRate),
      volume: input.volume,
      volume_control_kind: 'software',
      fallback_reason: null,
      signal_path: {
        source: {
          codec: asset?.codec ?? (container.toLowerCase() || 'dsd'),
          sampleRate: sourceRate || undefined,
          bitDepth: 1,
          dsdRate: sourceRate || undefined,
          channels: asset?.channels ?? 0,
        },
        decode: { format: 'pcm', sampleRate: outputRate, representation: 'Float32' },
        processing: {
          resampled: outputRate > 0 && sourceRate > 0 && outputRate !== sourceRate,
          ...(outputRate > 0 && sourceRate > 0 && outputRate !== sourceRate
            ? { resampler: 'DSD low-pass decimator' }
            : {}),
          eq: false,
          replayGain: false,
          normalization: false,
        },
        output: { audioContextSampleRate: outputRate },
        qualityMode,
      },
    };
  }

  const codec = asset?.codec ? asset.codec.toUpperCase() : container || 'PCM';
  const sourceFormat = [codec, sourceDepth > 0 ? `${sourceDepth}-bit` : null, formatAudioRate(sourceRate)]
    .filter((part, index, parts) => part && part !== '—' && parts.indexOf(part) === index)
    .join(' / ')
    .replace(`${codec} / ${codec}`, codec);

  const outputRate = input.pcmOutputSampleRate && input.pcmOutputSampleRate > 0
    ? input.pcmOutputSampleRate
    : sourceRate;
  const outputDepth = input.pcmOutputBitDepth && input.pcmOutputBitDepth > 0
    ? input.pcmOutputBitDepth
    : 32;

  return {
    output_mode: BROWSER_AUDIO_CORE_MODE,
    bit_perfect: false,
    is_native: false,
    output_sample_rate: outputRate,
    output_bit_depth: outputDepth,
    source_label: codec,
    backend: 'shared',
    dsd_output_mode: 'pcm',
    source_format: sourceFormat || codec,
    source_sample_rate: sourceRate,
    source_bit_depth: sourceDepth || 0,
    dsd_transport: null,
    output_format: formatPcmLabel(outputDepth, outputRate),
    volume: input.volume,
    volume_control_kind: 'software',
    fallback_reason: null,
    signal_path: {
      source: {
        codec: asset?.codec ?? (container.toLowerCase() || 'pcm'),
        sampleRate: sourceRate || undefined,
        bitDepth: sourceDepth || undefined,
        channels: asset?.channels ?? 0,
      },
      decode: { format: 'pcm', sampleRate: outputRate, representation: 'Float32' },
      processing: {
        resampled: outputRate > 0 && sourceRate > 0 && outputRate !== sourceRate,
        ...(outputRate > 0 && sourceRate > 0 && outputRate !== sourceRate
          ? { resampler: 'Browser/OS managed' }
          : {}),
        eq: false,
        replayGain: false,
        normalization: false,
      },
      output: { audioContextSampleRate: outputRate },
      qualityMode,
    },
  };
}

export function isBrowserDsdDescriptor(descriptor: StreamDescriptor | null): boolean {
  if (!descriptor) return false;
  return isDsdFormat(descriptor.asset.codec, descriptor.asset.container)
    || descriptor.asset.isDsd === true;
}

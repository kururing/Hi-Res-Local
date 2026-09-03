export interface AudioClassification {
  lossless: boolean;
  hiRes: boolean;
  dsd: boolean;
  dsdRate: number | null;
}

const LOSSLESS = new Set(['flac', 'alac', 'pcm', 'dsd']);
const DSD_CODECS = new Set(['dsd', 'dsd_lsbf', 'dsd_msbf', 'dsd_lsbf_planar', 'dst']);
const DSD_CONTAINERS = new Set(['dsf', 'dff']);

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

export function classifyAudio(input: {
  codec: string;
  container: string;
  sampleRateHz: number;
  bitDepth: number | null;
  isLossless?: boolean;
}): AudioClassification {
  const codec = input.codec.trim().toLowerCase();
  const container = input.container.trim().toLowerCase();
  const dsd = DSD_CODECS.has(codec) || DSD_CONTAINERS.has(container) || codec.startsWith('dsd');
  const lossless = input.isLossless ?? (LOSSLESS.has(codec) || dsd);
  const hiRes = dsd || (lossless && (input.sampleRateHz > 48_000 || (input.bitDepth ?? 0) > 16));
  return {
    lossless,
    hiRes,
    dsd,
    dsdRate: dsd ? dsdRateFromSampleRateHz(input.sampleRateHz) : null,
  };
}

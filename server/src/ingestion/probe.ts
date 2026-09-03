import { classifyAudio } from './classification.js';
import { extractNnpmProbeTagMaps, hasAttachedPicture, mapTagRecord, type MappedAudioTags } from './tags.js';

export interface ProbedAudioMetadata {
  container: string;
  codec: string;
  durationSeconds: number;
  sampleRateHz: number;
  bitDepth: number | null;
  channels: number;
  channelLayout: string | null;
  bitrateKbps: number | null;
  isLossless: boolean;
  hiRes: boolean;
  dsd: boolean;
  dsdRate?: number | null;
  hasAudioStream: boolean;
  hasAttachedPicture: boolean;
  mqaStatus?: string | null;
  mqaOrigSampleRate?: number | null;
  tags: MappedAudioTags;
}

export interface AudioProbe {
  inspect(path: string): Promise<ProbedAudioMetadata>;
}

export class ProbeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.retryable = retryable;
  }
}

const CONTAINER_BY_FORMAT: Record<string, string> = {
  flac: 'flac',
  aiff: 'aiff',
  aif: 'aiff',
  mp3: 'mp3',
  mp2: 'mp3',
  mov: 'm4a',
  mp4: 'm4a',
  m4a: 'm4a',
  aac: 'm4a',
  ogg: 'ogg',
  oga: 'ogg',
  webm: 'webm',
  matroska: 'webm',
  dsf: 'dsf',
  dff: 'dff',
  dsd: 'dsf',
  iff: 'dff',
};

const CODEC_ALIASES: Record<string, string> = {
  flac: 'flac',
  alac: 'alac',
  pcm_s16le: 'pcm',
  pcm_s24le: 'pcm',
  pcm_s32le: 'pcm',
  pcm_s16be: 'pcm',
  pcm_s24be: 'pcm',
  pcm_f32le: 'pcm',
  mp3: 'mp3',
  mp3float: 'mp3',
  aac: 'aac',
  opus: 'opus',
  vorbis: 'vorbis',
  dsd: 'dsd',
  dsd_lsbf: 'dsd',
  dsd_msbf: 'dsd',
  dsd_lsbf_planar: 'dsd',
  dst: 'dsd',
};

const LOSSLESS = new Set(['flac', 'alac', 'pcm', 'dsd']);

const BIT_DEPTH_FROM_CODEC: Record<string, number> = {
  pcm_s16le: 16,
  pcm_s16be: 16,
  pcm_s24le: 24,
  pcm_s24be: 24,
  pcm_s32le: 32,
  pcm_f32le: 32,
};

export const SUPPORTED_AUDIO = new Set([
  'flac:flac',
  'alac:m4a',
  'pcm:wav',
  'pcm:aiff',
  'mp3:mp3',
  'aac:m4a',
  'opus:ogg',
  'opus:webm',
  'opus:opus',
  'vorbis:ogg',
  'dsd:dsf',
  'dsd:dff',
]);

export function parseNnpmProbeJson(raw: string): ProbedAudioMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProbeError('PROBE_PARSE_FAILED', 'Media probe output was not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ProbeError('PROBE_PARSE_FAILED', 'Media probe output was empty.');
  }
  const asNnpm = parsed as { duration_seconds?: unknown; container?: unknown };
  if (typeof asNnpm.duration_seconds === 'number' && typeof asNnpm.container === 'string') {
    return parseNativeProbeJson(parsed);
  }

  const root = parsed as {
    format?: {
      format_name?: string;
      duration?: string;
      bit_rate?: string;
      tags?: Record<string, unknown>;
    };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
      channel_layout?: string;
      bits_per_raw_sample?: string;
      bits_per_sample?: number;
      bit_rate?: string;
      duration?: string;
      disposition?: { attached_pic?: number };
      tags?: Record<string, unknown>;
    }>;
  };

  const audio = (root.streams ?? []).find((stream) => stream.codec_type === 'audio');
  if (!audio) {
    throw new ProbeError('PROBE_NO_AUDIO', 'No audio stream was found.');
  }

  const formatName = (root.format?.format_name ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  let container = CONTAINER_BY_FORMAT[formatName] ?? formatName;
  const codecRaw = (audio.codec_name ?? '').toLowerCase();
  let codec = CODEC_ALIASES[codecRaw] ?? (codecRaw.startsWith('dsd') ? 'dsd' : codecRaw);
  if (codec === 'dsd' && container !== 'dsf' && container !== 'dff') {
    container = formatName === 'dff' || formatName === 'iff' ? 'dff' : 'dsf';
  }
  const duration = Number(audio.duration ?? root.format?.duration ?? 0);
  const sampleRateHz = Number(audio.sample_rate ?? 0);
  const channels = Number(audio.channels ?? 0);
  const bitDepth = audio.bits_per_raw_sample
    ? Number(audio.bits_per_raw_sample)
    : audio.bits_per_sample
      ? Number(audio.bits_per_sample)
      : BIT_DEPTH_FROM_CODEC[codecRaw] ?? null;
  const bitrateKbps = audio.bit_rate || root.format?.bit_rate
    ? Math.round(Number(audio.bit_rate ?? root.format?.bit_rate) / 1000)
    : null;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ProbeError('PROBE_INVALID_DURATION', 'Duration from probe was invalid.');
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new ProbeError('PROBE_INVALID_RATE', 'Sample rate from probe was invalid.');
  }
  if (!Number.isFinite(channels) || channels <= 0) {
    throw new ProbeError('PROBE_INVALID_CHANNELS', 'Channel count from probe was invalid.');
  }
  if (!SUPPORTED_AUDIO.has(`${codec}:${container}`)) {
    throw new ProbeError('PROBE_UNSUPPORTED', `Unsupported audio format ${codec}/${container}.`);
  }

  const resolvedBitDepth = bitDepth && Number.isFinite(bitDepth) ? bitDepth : null;
  const classification = classifyAudio({
    codec,
    container,
    sampleRateHz,
    bitDepth: resolvedBitDepth,
    isLossless: LOSSLESS.has(codec),
  });

  return {
    container,
    codec,
    durationSeconds: duration,
    sampleRateHz,
    bitDepth: resolvedBitDepth,
    channels,
    channelLayout: audio.channel_layout?.trim() || null,
    bitrateKbps: bitrateKbps && Number.isFinite(bitrateKbps) ? bitrateKbps : null,
    isLossless: classification.lossless,
    hiRes: classification.hiRes,
    dsd: classification.dsd,
    dsdRate: classification.dsdRate,
    hasAudioStream: true,
    hasAttachedPicture: hasAttachedPicture(root),
    tags: mapTagRecord(extractNnpmProbeTagMaps(root)),
  };
}

function parseNativeProbeJson(parsed: unknown): ProbedAudioMetadata {
  const root = parsed as {
    container?: string;
    codec?: string;
    duration_seconds?: number;
    sample_rate_hz?: number;
    bit_depth?: number | null;
    channels?: number;
    channel_layout?: string | null;
    bitrate_kbps?: number | null;
    is_lossless?: boolean;
    hi_res?: boolean;
    dsd?: boolean;
    dsd_rate?: number | null;
    has_audio_stream?: boolean;
    has_attached_picture?: boolean;
    mqa?: { status?: string; orig_sample_rate?: number };
    tags?: Record<string, string | null | undefined>;
  };
  const container = (root.container ?? '').toLowerCase();
  const codec = (root.codec ?? '').toLowerCase();
  const duration = Number(root.duration_seconds ?? 0);
  const sampleRateHz = Number(root.sample_rate_hz ?? 0);
  const channels = Number(root.channels ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ProbeError('PROBE_INVALID_DURATION', 'Duration from probe was invalid.');
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new ProbeError('PROBE_INVALID_RATE', 'Sample rate from probe was invalid.');
  }
  if (!Number.isFinite(channels) || channels <= 0) {
    throw new ProbeError('PROBE_INVALID_CHANNELS', 'Channel count from probe was invalid.');
  }
  if (!SUPPORTED_AUDIO.has(`${codec}:${container}`)) {
    throw new ProbeError('PROBE_UNSUPPORTED', `Unsupported audio format ${codec}/${container}.`);
  }
  const bitDepth = root.bit_depth != null && Number.isFinite(Number(root.bit_depth))
    ? Number(root.bit_depth)
    : null;
  const classification = classifyAudio({
    codec,
    container,
    sampleRateHz,
    bitDepth,
    isLossless: root.is_lossless ?? LOSSLESS.has(codec),
  });
  const tagMap = new Map<string, string>();
  const rawTags = root.tags ?? {};
  for (const [key, value] of Object.entries(rawTags)) {
    if (typeof value === 'string' && value.trim()) tagMap.set(key.toLowerCase(), value);
  }
  const tags = mapTagRecord(tagMap);
  return {
    container,
    codec,
    durationSeconds: duration,
    sampleRateHz,
    bitDepth,
    channels,
    channelLayout: root.channel_layout ?? null,
    bitrateKbps: root.bitrate_kbps ?? null,
    isLossless: classification.lossless,
    hiRes: classification.hiRes,
    dsd: classification.dsd,
    dsdRate: classification.dsdRate ?? root.dsd_rate ?? null,
    hasAudioStream: root.has_audio_stream !== false,
    hasAttachedPicture: Boolean(root.has_attached_picture),
    mqaStatus: root.mqa?.status && root.mqa.status !== 'none' ? root.mqa.status : null,
    mqaOrigSampleRate: root.mqa?.orig_sample_rate || null,
    tags,
  };
}

/**
 * Maps catalog codec/container pairs to a Content-Type the browser and
 * object storage can use. Original bytes are never transcoded.
 */
const MIME_BY_FORMAT: ReadonlyArray<{
  codec: string;
  container: string;
  mimeType: string;
}> = [
  { codec: 'flac', container: 'flac', mimeType: 'audio/flac' },
  { codec: 'mp3', container: 'mp3', mimeType: 'audio/mpeg' },
  { codec: 'mp3', container: 'mpeg', mimeType: 'audio/mpeg' },
  { codec: 'aac', container: 'm4a', mimeType: 'audio/mp4' },
  { codec: 'aac', container: 'mp4', mimeType: 'audio/mp4' },
  { codec: 'alac', container: 'm4a', mimeType: 'audio/mp4' },
  { codec: 'alac', container: 'mp4', mimeType: 'audio/mp4' },
  { codec: 'opus', container: 'webm', mimeType: 'audio/webm' },
  { codec: 'opus', container: 'ogg', mimeType: 'audio/ogg' },
  { codec: 'vorbis', container: 'ogg', mimeType: 'audio/ogg' },
  { codec: 'pcm', container: 'wav', mimeType: 'audio/wav' },
  { codec: 'pcm', container: 'wave', mimeType: 'audio/wav' },
  { codec: 'wav', container: 'wav', mimeType: 'audio/wav' },
  { codec: 'dsd', container: 'dsf', mimeType: 'audio/dsf' },
  { codec: 'dsd', container: 'dff', mimeType: 'audio/dff' },
];

const CODEC_ALIASES: Record<string, string> = {
  mpeg: 'mp3',
  mp3: 'mp3',
  flac: 'flac',
  aac: 'aac',
  mp4a: 'aac',
  alac: 'alac',
  opus: 'opus',
  vorbis: 'vorbis',
  pcm: 'pcm',
  wav: 'pcm',
  wave: 'pcm',
  dsd: 'dsd',
  dsf: 'dsd',
  dff: 'dsd',
};

const CONTAINER_ALIASES: Record<string, string> = {
  flac: 'flac',
  mp3: 'mp3',
  mpeg: 'mp3',
  m4a: 'm4a',
  mp4: 'm4a',
  aac: 'm4a',
  webm: 'webm',
  ogg: 'ogg',
  oga: 'ogg',
  wav: 'wav',
  wave: 'wav',
  dsf: 'dsf',
  dff: 'dff',
};
export function normalizeCodec(value: string): string {
  return CODEC_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
}

export function normalizeContainer(value: string): string {
  return CONTAINER_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
}

export function audioMimeType(codec: string, container: string): string | undefined {
  const normalizedCodec = normalizeCodec(codec);
  const normalizedContainer = normalizeContainer(container);
  return MIME_BY_FORMAT.find(
    (entry) => entry.codec === normalizedCodec && normalizeContainer(entry.container) === normalizedContainer,
  )?.mimeType;
}

export interface FormatHint {
  codec: string;
  container: string;
  mimeType?: string;
}

export function formatsCompatible(
  asset: { codec: string; container: string },
  hint: FormatHint,
): boolean {
  return normalizeCodec(asset.codec) === normalizeCodec(hint.codec)
    && normalizeContainer(asset.container) === normalizeContainer(hint.container);
}

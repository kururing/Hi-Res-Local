export const AUDIO_EXTENSIONS: Record<string, string> = {
  flac: 'flac',
  wav: 'wav',
  wave: 'wav',
  aiff: 'aiff',
  aif: 'aiff',
  mp3: 'mp3',
  m4a: 'm4a',
  mp4: 'm4a',
  aac: 'm4a',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'opus',
  webm: 'webm',
  dsf: 'dsf',
  dff: 'dff',
};

export const AUDIO_MIME_TO_HINT: Record<string, string> = {
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/opus': 'opus',
  'audio/dsf': 'dsf',
  'audio/x-dsf': 'dsf',
  'audio/dff': 'dff',
  'audio/x-dff': 'dff',
  'application/x-dff': 'dff',
};

export const ARTWORK_EXTENSIONS: Record<string, string> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

export function normalizeExtension(filename: string, allowed: Record<string, string>): string | null {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  if (!match) return null;
  return allowed[match[1] ?? ''] ?? null;
}

export function audioTempExtension(filename: string, mime?: string): string {
  const fromName = normalizeExtension(filename, AUDIO_EXTENSIONS);
  if (fromName) return `.${fromName}`;
  const fromMime = mime ? AUDIO_MIME_TO_HINT[mime.trim().toLowerCase()] : undefined;
  if (fromMime) return `.${fromMime}`;
  return '.bin';
}

export function buildObjectKey(kind: 'audio' | 'artwork', uploadId: string, filename: string): string {
  const allowed = kind === 'audio' ? AUDIO_EXTENSIONS : ARTWORK_EXTENSIONS;
  const ext = normalizeExtension(filename, allowed);
  const prefix = kind === 'audio' ? 'ingestion/audio' : 'ingestion/artwork';
  return ext ? `${prefix}/${uploadId}.${ext}` : `${prefix}/${uploadId}`;
}

export function isIngestionKey(objectKey: string): boolean {
  return objectKey.startsWith('ingestion/audio/') || objectKey.startsWith('ingestion/artwork/');
}

export function mimeFromAudioFilename(filename: string): string {
  const ext = normalizeExtension(filename, AUDIO_EXTENSIONS);
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'aiff' || ext === 'aif') return 'audio/aiff';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'dsf') return 'audio/dsf';
  if (ext === 'dff') return 'audio/dff';
  return 'application/octet-stream';
}

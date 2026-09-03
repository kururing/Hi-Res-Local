/** Random-access compressed bytes. The decoder must not know about URLs or MinIO. */
export interface RandomAccessSource {
  size(): number;
  read(offset: number, length: number): Promise<Uint8Array>;
  abort(): void;
  tryReadCached(offset: number, length: number): Uint8Array | null;
  invalidatePlaybackWindows(): void;
  compactPlayback(): void;
  cachedByteCount(): number;
}

export interface NeedBytes {
  needOffset: number;
  needLength: number;
}

export const RANGE_WINDOW_BYTES = 256 * 1024;
export const RANGE_WINDOW_MAX_BYTES = 1024 * 1024;
export const RANGE_HEADER_BYTES = 256 * 1024;
export const MAX_OPEN_CACHE_BYTES = 32 * 1024 * 1024;
export const MAX_PLAYBACK_CACHE_BYTES = RANGE_HEADER_BYTES + RANGE_WINDOW_MAX_BYTES;
/** Whole-object 200 responses are allowed only for tiny files, never hi-res. */
export const MAX_PROGRESSIVE_FALLBACK_BYTES = 8 * 1024 * 1024;
/** DST / non-range codecs only. Not used on the FLAC/PCM Range path. */
export const MAX_BOUNDED_WHOLE_FILE_BYTES = 256 * 1024 * 1024;

export function isNeedBytes(value: unknown): value is NeedBytes {
  if (typeof value !== 'object' || value == null) return false;
  const offset = (value as { needOffset?: unknown }).needOffset;
  return typeof offset === 'number' && Number.isFinite(offset) && offset >= 0;
}

export function expandNeedLength(length: number): number {
  const want = Number.isFinite(length) ? Math.max(1, Math.ceil(length)) : RANGE_WINDOW_BYTES;
  return Math.min(RANGE_WINDOW_MAX_BYTES, Math.max(RANGE_WINDOW_BYTES, want));
}

export function hintExtFromUrl(url: string): string {
  try {
    const path = new URL(url, 'https://nnpm.invalid').pathname;
    const slash = path.lastIndexOf('/');
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return '';
    return name.slice(dot + 1).toLowerCase();
  } catch {
    return '';
  }
}

export function parseContentRangeTotal(header: string | null | undefined): number | null {
  if (!header) return null;
  const total = header.split('/')[1]?.trim();
  if (!total || total === '*') return null;
  const size = Number(total);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

export function parseRangeRequestHeader(value: string | null | undefined): { start: number; end: number } | null {
  if (!value) return null;
  const match = value.match(/bytes=(\d+)-(\d+)?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] != null ? Number(match[2]) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(start) || start < 0) return null;
  return { start, end };
}

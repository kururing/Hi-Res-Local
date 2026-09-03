const DIRECT_ARTWORK_SOURCE = /^(data:|blob:|https?:\/\/)/i;

export function isDirectArtworkSource(value: string): boolean {
  return DIRECT_ARTWORK_SOURCE.test(value.trim());
}

/**
 * Keep browser-safe image URLs and drop filesystem paths. Used by web and
 * mock preview so local paths never become `img` sources.
 */
export function resolveBrowserArtworkSource(
  source: string | null | undefined,
): string | null {
  if (source == null) return null;
  const value = source.trim();
  if (!value) return null;
  if (isDirectArtworkSource(value)) return value;
  return null;
}

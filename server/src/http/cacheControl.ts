export type CacheClass =
  | 'no-store'
  | 'private-no-store'
  | 'public-short'
  | 'public-immutable';

export function cacheControlForPath(
  method: string,
  path: string,
  options: { catalogPublic: boolean; authenticated: boolean },
): string | null {
  if (method === 'OPTIONS' || method === 'HEAD' && path.startsWith('/health')) {
    return 'no-store';
  }

  if (
    path.startsWith('/v1/auth')
    || path === '/v1/me'
    || path.startsWith('/v1/me/preferences')
    || path.startsWith('/v1/admin')
    || /\/v1\/tracks\/[^/]+\/(stream|source|artwork)$/.test(path)
    || path === '/metrics'
  ) {
    return 'no-store';
  }

  if (
    path.startsWith('/v1/library')
    || path.startsWith('/v1/playlists')
    || path.startsWith('/v1/favorites')
    || path.startsWith('/v1/history')
    || path.startsWith('/v1/lyrics')
  ) {
    return 'private, no-store';
  }

  if (path.startsWith('/v1/catalog')) {
    if (!options.catalogPublic || options.authenticated) {
      return 'private, no-store';
    }
    return 'public, max-age=30, must-revalidate';
  }

  if (path.startsWith('/health')) {
    return 'no-store';
  }

  return null;
}

export const ARTWORK_CACHE_CONTROL = 'public, max-age=31536000, immutable';

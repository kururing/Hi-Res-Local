import { convertFileSrc } from '@tauri-apps/api/core';
import { IpcService, isTauri } from './ipc';

const CACHE_KEY = 'nghenhac_remote_artwork_itunes_v3';
const DISCORD_URL_CACHE_KEY = 'nghenhac_remote_artwork_itunes_urls_v1';
const LEGACY_CACHE_KEYS = [
  'nghenhac_remote_artwork_v3',
  'nghenhac_remote_artwork_itunes_v1',
  'nghenhac_remote_artwork_itunes_v2',
];
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP_URL = 'https://itunes.apple.com/lookup';
const NETWORK_TIMEOUT_MS = 7_500;
const ITUNES_REQUEST_CONCURRENCY = 4;

type ArtworkKind = 'album' | 'artist';
type ArtworkCache = Record<string, string>;

interface ITunesAlbumResult {
  wrapperType?: string;
  artistId?: number;
  artistName?: string;
  artistLinkUrl?: string;
  artistViewUrl?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

interface ITunesSearchResponse {
  results?: ITunesAlbumResult[];
}

const memoryCache = new Map<string, string>();
const discordUrlCache = new Map<string, string>();
const missingArtwork = new Set<string>();
const pending = new Map<string, Promise<string | null>>();
let diskCache: ArtworkCache | null = null;
let activeITunesRequests = 0;
const queuedITunesRequests: Array<{
  run: () => Promise<ITunesSearchResponse>;
  resolve: (value: ITunesSearchResponse) => void;
  reject: (reason?: unknown) => void;
}> = [];
const ARTIST_ARTWORK_CONCURRENCY = 4;
let activeArtistArtworkRequests = 0;
const queuedArtistArtworkRequests: Array<{
  run: () => Promise<string | null>;
  resolve: (value: string | null) => void;
  reject: (reason?: unknown) => void;
}> = [];
let cacheGeneration = 0;

const readCache = (): ArtworkCache => {
  if (diskCache) return diskCache;
  try {
    LEGACY_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
    diskCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as ArtworkCache;
  }
  catch { diskCache = {}; }
  return diskCache;
};

const writeCache = (cache: ArtworkCache) => {
  diskCache = cache;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage quota */ }
};

const keyFor = (kind: ArtworkKind, artist: string, album?: string) =>
  `${kind}:${artist.trim().toLocaleLowerCase()}:${album?.trim().toLocaleLowerCase() || ''}`;

const normalizeName = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const matchScore = (found: string, expected: string) => {
  const actual = normalizeName(found);
  const target = normalizeName(expected);
  if (!actual || !target) return 0;
  if (actual === target) return 5;
  return actual.includes(target) || target.includes(actual) ? 3 : 0;
};

const createLinkedTimeout = (externalSignal?: AbortSignal) => {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new DOMException('Artwork request timed out', 'TimeoutError')), NETWORK_TIMEOUT_MS);
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
};

const fetchJson = async <T,>(url: string, externalSignal?: AbortSignal): Promise<T> => {
  const request = createLinkedTimeout(externalSignal);
  try {
    const response = await fetch(url, {
      signal: request.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`iTunes artwork lookup failed: ${response.status}`);
    return await response.json() as T;
  } finally {
    request.dispose();
  }
};

const pumpITunesRequests = () => {
  while (activeITunesRequests < ITUNES_REQUEST_CONCURRENCY && queuedITunesRequests.length > 0) {
    const request = queuedITunesRequests.shift()!;
    activeITunesRequests += 1;
    request.run().then(request.resolve, request.reject).finally(() => {
      activeITunesRequests -= 1;
      pumpITunesRequests();
    });
  }
};

const requestITunes = (url: string, signal?: AbortSignal): Promise<ITunesSearchResponse> => new Promise((resolve, reject) => {
  queuedITunesRequests.push({
    run: () => {
      signal?.throwIfAborted();
      return fetchJson<ITunesSearchResponse>(url, signal);
    },
    resolve,
    reject,
  });
  pumpITunesRequests();
});

const searchITunes = (params: URLSearchParams, signal?: AbortSignal) =>
  requestITunes(`${ITUNES_SEARCH_URL}?${params}`, signal);

const findArtist = async (artist: string, signal?: AbortSignal): Promise<ITunesAlbumResult | null> => {
  const search = await searchITunes(new URLSearchParams({
    term: artist,
    media: 'music',
    entity: 'musicArtist',
    attribute: 'artistTerm',
    country: 'vn',
    limit: '10',
  }), signal);
  return (search.results || [])
    .filter(item => item.artistId && item.artistName)
    .map(item => ({ item, score: matchScore(item.artistName || '', artist) }))
    .sort((a, b) => b.score - a.score)[0]?.item ?? null;
};

const fetchArtistArtworkUrl = async (artist: string, signal?: AbortSignal): Promise<string | null> => {
  const match = await findArtist(artist, signal);
  if (!match?.artistId || matchScore(match.artistName || '', artist) < 3) return null;

  if (isTauri()) {
    try {
      signal?.throwIfAborted();
      const portrait = await IpcService.invoke('get_apple_music_artist_artwork', {
        country: 'vn',
        artistId: match.artistId,
      });
      signal?.throwIfAborted();
      if (portrait) return portrait.replace(/^http:/i, 'https:');
    } catch (error) {
      if (signal?.aborted) throw error;
      // Fall back to album artwork when Apple Music is unavailable.
    }
  }

  const lookup = await requestITunes(`${ITUNES_LOOKUP_URL}?${new URLSearchParams({
    id: String(match.artistId),
    entity: 'album',
    country: 'vn',
    limit: '25',
  })}`, signal);
  const album = (lookup.results || []).find(item =>
    item.artworkUrl100 && matchScore(item.artistName || '', artist) >= 3
  );
  return album?.artworkUrl100 ? toLargeArtworkUrl(album.artworkUrl100) : null;
};

const pumpArtistArtworkRequests = () => {
  while (
    activeArtistArtworkRequests < ARTIST_ARTWORK_CONCURRENCY
    && queuedArtistArtworkRequests.length > 0
  ) {
    const request = queuedArtistArtworkRequests.shift()!;
    activeArtistArtworkRequests += 1;
    request.run().then(request.resolve, request.reject).finally(() => {
      activeArtistArtworkRequests -= 1;
      pumpArtistArtworkRequests();
    });
  }
};

const findArtistArtworkUrl = (artist: string, signal?: AbortSignal): Promise<string | null> => new Promise((resolve, reject) => {
  queuedArtistArtworkRequests.push({
    run: () => {
      signal?.throwIfAborted();
      return fetchArtistArtworkUrl(artist, signal);
    },
    resolve,
    reject,
  });
  pumpArtistArtworkRequests();
});

const toLargeArtworkUrl = (url: string) => url
  .replace(/\/\d+x\d+(?:bb)?([.-])/i, '/600x600bb$1')
  .replace(/^http:/i, 'https:');

const toDataUrl = async (url: string, externalSignal?: AbortSignal): Promise<string> => {
  const request = createLinkedTimeout(externalSignal);
  try {
    const response = await fetch(url, { mode: 'cors', signal: request.signal });
    if (!response.ok) throw new Error(`iTunes artwork request failed: ${response.status}`);
    const blob = await response.blob();
    request.signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abortReader = () => {
        reader.abort();
        reject(request.signal.reason ?? new DOMException('Artwork request aborted', 'AbortError'));
      };
      request.signal.addEventListener('abort', abortReader, { once: true });
      reader.onload = () => {
        request.signal.removeEventListener('abort', abortReader);
        resolve(String(reader.result));
      };
      reader.onerror = () => {
        request.signal.removeEventListener('abort', abortReader);
        reject(reader.error ?? new Error('Artwork decode failed'));
      };
      reader.readAsDataURL(blob);
    });
  } finally {
    request.dispose();
  }
};

const persistArtwork = async (key: string, source: string): Promise<string> => {
  if (!isTauri()) return source;
  const path = await IpcService.invoke('cache_image_data', {
    cacheKey: key,
    category: 'remote-artwork',
    dataUrl: source,
  });
  return convertFileSrc(path);
};

const findITunesArtworkUrl = async (kind: ArtworkKind, artist: string, album?: string, signal?: AbortSignal): Promise<string | null> => {
  if (kind === 'artist') return findArtistArtworkUrl(artist, signal);
  const term = `${artist} ${album || ''}`.trim();
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'album',
    country: 'vn',
    limit: '25',
  });
  const search = await searchITunes(params, signal);
  const candidates = (search.results || [])
    .filter(item => item.artworkUrl100 && item.artistName)
    .map(item => ({
      item,
      score: matchScore(item.artistName || '', artist)
        + matchScore(item.collectionName || '', album || ''),
    }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  // Local files often contain shortened artist/album names or soundtrack
  // suffixes. Accept a strong match on either field so artwork lookup does
  // not fail just because the other metadata differs slightly.
  const minimumScore = 3;
  if (!best || best.score < minimumScore || !best.item.artworkUrl100) return null;
  return toLargeArtworkUrl(best.item.artworkUrl100);
};

export const getCachedArtwork = (kind: ArtworkKind, artist: string, album?: string) =>
  memoryCache.get(keyFor(kind, artist, album)) ?? readCache()[keyFor(kind, artist, album)] ?? null;

export const clearArtworkCache = () => {
  cacheGeneration += 1;
  memoryCache.clear();
  discordUrlCache.clear();
  missingArtwork.clear();
  pending.clear();
  diskCache = {};
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(DISCORD_URL_CACHE_KEY);
    LEGACY_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
  } catch { /* storage unavailable */ }
  if (isTauri()) {
    void IpcService.invoke('clear_image_cache', { category: 'remote-artwork' }).catch(() => undefined);
  }
};

/** Returns the public iTunes artwork URL for integrations such as Discord. */
export const getArtworkUrlForDiscord = async (artist: string, album?: string): Promise<string | null> => {
  const key = keyFor('album', artist, album);
  if (!artist.trim() || !album?.trim() || !navigator.onLine) return null;
  const cached = discordUrlCache.get(key);
  if (cached) return cached;
  try {
    const stored = JSON.parse(localStorage.getItem(DISCORD_URL_CACHE_KEY) || '{}') as ArtworkCache;
    if (stored[key]) {
      discordUrlCache.set(key, stored[key]);
      return stored[key];
    }
    const url = await findITunesArtworkUrl('album', artist, album);
    if (!url) return null;
    discordUrlCache.set(key, url);
    try { localStorage.setItem(DISCORD_URL_CACHE_KEY, JSON.stringify({ ...stored, [key]: url })); } catch { /* storage quota */ }
    return url;
  } catch {
    return null;
  }
};

export const downloadArtwork = async (kind: ArtworkKind, artist: string, album?: string, signal?: AbortSignal): Promise<string | null> => {
  const key = keyFor(kind, artist, album);
  if (!artist.trim() || !navigator.onLine || missingArtwork.has(key)) {
    return getCachedArtwork(kind, artist, album);
  }

  const cache = readCache();
  if (cache[key]) return cache[key];
  const existing = pending.get(key);
  if (existing) return existing;

  const requestGeneration = cacheGeneration;
  const request = (async () => {
    try {
      signal?.throwIfAborted();
      const rawUrl = await findITunesArtworkUrl(kind, artist, album, signal);
      if (!rawUrl) {
        if (requestGeneration === cacheGeneration) missingArtwork.add(key);
        return null;
      }
      const downloaded = await toDataUrl(rawUrl, signal);
      signal?.throwIfAborted();
      const cachedSource = await persistArtwork(key, downloaded);
      signal?.throwIfAborted();
      if (requestGeneration !== cacheGeneration) return cachedSource;
      memoryCache.set(key, cachedSource);
      writeCache({ ...readCache(), [key]: cachedSource });
      return cachedSource;
    } catch {
      return null;
    }
  })();
  pending.set(key, request);
  void request.finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  return request;
};

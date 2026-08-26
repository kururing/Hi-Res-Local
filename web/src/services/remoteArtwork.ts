import { convertFileSrc } from '@tauri-apps/api/core';
import { IpcService, isTauri } from './ipc';

const CACHE_KEY = 'nghenhac_remote_artwork_itunes_v1';
const DISCORD_URL_CACHE_KEY = 'nghenhac_remote_artwork_itunes_urls_v1';
const LEGACY_CACHE_KEYS = ['nghenhac_remote_artwork_v3'];
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP_URL = 'https://itunes.apple.com/lookup';
const REQUEST_INTERVAL_MS = 3_100;

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
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
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

const fetchJson = async <T,>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7_500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`iTunes artwork lookup failed: ${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
};

const requestITunes = (url: string): Promise<ITunesSearchResponse> => {
  const request = requestQueue.then(async () => {
    const waitMs = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise(resolve => window.setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    return await fetchJson<ITunesSearchResponse>(url);
  });
  requestQueue = request.catch(() => undefined);
  return request;
};

const searchITunes = (params: URLSearchParams) =>
  requestITunes(`${ITUNES_SEARCH_URL}?${params}`);

const findArtist = async (artist: string): Promise<ITunesAlbumResult | null> => {
  const search = await searchITunes(new URLSearchParams({
    term: artist,
    media: 'music',
    entity: 'musicArtist',
    attribute: 'artistTerm',
    country: 'vn',
    limit: '10',
  }));
  return (search.results || [])
    .filter(item => item.artistId && item.artistName)
    .map(item => ({ item, score: matchScore(item.artistName || '', artist) }))
    .sort((a, b) => b.score - a.score)[0]?.item ?? null;
};

const findArtistArtworkUrl = async (artist: string): Promise<string | null> => {
  const match = await findArtist(artist);
  if (!match?.artistId || matchScore(match.artistName || '', artist) < 3) return null;

  const lookup = await requestITunes(`${ITUNES_LOOKUP_URL}?${new URLSearchParams({
    id: String(match.artistId),
    entity: 'album',
    country: 'vn',
    limit: '25',
  })}`);
  const album = (lookup.results || []).find(item =>
    item.artworkUrl100 && matchScore(item.artistName || '', artist) >= 3
  );
  return album?.artworkUrl100 ? toLargeArtworkUrl(album.artworkUrl100) : null;
};

const toLargeArtworkUrl = (url: string) => url
  .replace(/\/\d+x\d+(?:bb)?([.-])/i, '/600x600bb$1')
  .replace(/^http:/i, 'https:');

const toDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`iTunes artwork request failed: ${response.status}`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Artwork decode failed'));
    reader.readAsDataURL(blob);
  });
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

const findITunesArtworkUrl = async (kind: ArtworkKind, artist: string, album?: string): Promise<string | null> => {
  if (kind === 'artist') return findArtistArtworkUrl(artist);
  const term = `${artist} ${album || ''}`.trim();
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'album',
    country: 'vn',
    limit: '25',
  });
  const search = await searchITunes(params);
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

export const downloadArtwork = async (kind: ArtworkKind, artist: string, album?: string): Promise<string | null> => {
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
      const rawUrl = await findITunesArtworkUrl(kind, artist, album);
      if (!rawUrl) {
        if (requestGeneration === cacheGeneration) missingArtwork.add(key);
        return null;
      }
      const downloaded = await toDataUrl(rawUrl);
      const cachedSource = await persistArtwork(key, downloaded);
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

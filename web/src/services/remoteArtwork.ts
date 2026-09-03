import type { ArtworkAssetsApi } from '../platform/contracts';
import { artistsShareIdentity } from './artistIdentity';

const CACHE_KEY = 'nghenhac_remote_artwork_itunes_v3';
const DISCORD_URL_CACHE_KEY = 'nghenhac_remote_artwork_itunes_urls_v1';
const ARTIST_MATCH_VERSION_KEY = 'nghenhac_remote_artwork_artist_match_version';
const ARTIST_MATCH_VERSION = 'album-evidence-v1';
const LEGACY_CACHE_KEYS = [
  'nghenhac_remote_artwork_v3',
  'nghenhac_remote_artwork_itunes_v1',
  'nghenhac_remote_artwork_itunes_v2',
];
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const NETWORK_TIMEOUT_MS = 7_500;
const ITUNES_REQUEST_CONCURRENCY = 4;
const MEMORY_CACHE_LIMIT = 2_000;
const DISCORD_CACHE_LIMIT = 1_000;
const MISSING_ARTWORK_LIMIT = 2_000;
const ARTIST_EVIDENCE_LIMIT = 2_000;

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
const artistIdEvidence = new Map<string, Map<number, number>>();
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

const setBoundedMap = <K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void => {
  // Delete first so an updated entry becomes the newest item.
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const addBoundedSet = <T>(cache: Set<T>, value: T, limit: number): void => {
  cache.delete(value);
  cache.add(value);
  while (cache.size > limit) {
    const oldest = cache.values().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const readCache = (): ArtworkCache => {
  if (diskCache) return diskCache;
  try {
    LEGACY_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as ArtworkCache;
    if (localStorage.getItem(ARTIST_MATCH_VERSION_KEY) !== ARTIST_MATCH_VERSION) {
      Object.keys(cache).forEach(key => {
        if (key.startsWith('artist:')) delete cache[key];
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      localStorage.setItem(ARTIST_MATCH_VERSION_KEY, ARTIST_MATCH_VERSION);
    }
    diskCache = cache;
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

// Artist names frequently differ only in typography between local tags and
// remote catalogues (for example, `Hwa Sa`, `Hwa-Sa`, and `Hwasa`). Keep this
// relaxed identity check scoped to artist matching so album-title matching
// remains conservative.
const matchArtistScore = (found: string, expected: string) => {
  if (artistsShareIdentity(found, expected)) return 5;
  return matchScore(found, expected);
};

const artistEvidenceKey = (artist: string) => normalizeName(artist).replace(/\s+/g, '');

const recordArtistIdEvidence = (localArtist: string, remoteArtist: string, artistId?: number) => {
  if (!artistId || matchArtistScore(remoteArtist, localArtist) < 3) return;
  const key = artistEvidenceKey(localArtist);
  const evidence = artistIdEvidence.get(key) ?? new Map<number, number>();
  evidence.set(artistId, (evidence.get(artistId) ?? 0) + 1);
  setBoundedMap(artistIdEvidence, key, evidence, ARTIST_EVIDENCE_LIMIT);
};

const getConfirmedArtistId = (artist: string): number | null => {
  const ranked = [...(artistIdEvidence.get(artistEvidenceKey(artist)) ?? new Map()).entries()]
    .sort((left, right) => right[1] - left[1]);
  if (ranked.length === 0) return null;
  // Equal evidence means the albums point to multiple artists with the same
  // display name. Fall back to a catalogue search instead of guessing.
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
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

const findArtist = async (artist: string, albumHint?: string, signal?: AbortSignal): Promise<ITunesAlbumResult | null> => {
  const confirmedArtistId = getConfirmedArtistId(artist);
  if (confirmedArtistId) {
    return { artistId: confirmedArtistId, artistName: artist };
  }

  if (albumHint?.trim()) {
    const albumSearch = await searchITunes(new URLSearchParams({
      term: `${artist} ${albumHint}`.trim(),
      media: 'music',
      entity: 'album',
      country: 'vn',
      limit: '25',
    }), signal);
    const albumCandidates = (albumSearch.results || [])
      .filter(item => item.artistId && item.artistName && item.collectionName)
      .map(item => ({
        item,
        artistScore: matchArtistScore(item.artistName || '', artist),
        albumScore: matchScore(item.collectionName || '', albumHint),
      }))
      .sort((left, right) =>
        (right.artistScore + right.albumScore) - (left.artistScore + left.albumScore)
      );
    const albumMatch = albumCandidates.find(candidate =>
      candidate.artistScore >= 3 && candidate.albumScore >= 3
    )?.item ?? null;
    if (albumMatch) return albumMatch;

    // Local tags and iTunes often describe the same release differently
    // (translated titles, "Pt. 6", or "- Single"). The combined search is
    // still useful identity evidence when every strong artist-name result
    // points to one artist ID. Do not use this fallback for namesakes.
    const strongArtistCandidates = albumCandidates.filter(candidate => candidate.artistScore >= 3);
    const artistIds = new Set(strongArtistCandidates.map(candidate => candidate.item.artistId));
    if (artistIds.size === 1) return strongArtistCandidates[0]?.item ?? null;
  }

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
    .map(item => ({ item, score: matchArtistScore(item.artistName || '', artist) }))
    .sort((a, b) => b.score - a.score)[0]?.item ?? null;
};

const fetchArtistArtworkUrl = async (
  artist: string,
  artworkAssets: ArtworkAssetsApi,
  albumHint?: string,
  signal?: AbortSignal,
): Promise<string | null> => {
  const match = await findArtist(artist, albumHint, signal);
  if (!match?.artistId || matchArtistScore(match.artistName || '', artist) < 3) return null;

  try {
    signal?.throwIfAborted();
    const portrait = await artworkAssets.getAppleMusicArtistArtwork('vn', match.artistId);
    signal?.throwIfAborted();
    if (portrait) return portrait.replace(/^http:/i, 'https:');
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  return null;
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

const findArtistArtworkUrl = (
  artist: string,
  artworkAssets: ArtworkAssetsApi,
  albumHint?: string,
  signal?: AbortSignal,
): Promise<string | null> => new Promise((resolve, reject) => {
  queuedArtistArtworkRequests.push({
    run: () => {
      signal?.throwIfAborted();
      return fetchArtistArtworkUrl(artist, artworkAssets, albumHint, signal);
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

const persistArtwork = async (
  key: string,
  source: string,
  artworkAssets: ArtworkAssetsApi,
): Promise<string> => artworkAssets.cacheRemoteArtwork(key, source);

const findITunesArtworkUrl = async (
  kind: ArtworkKind,
  artist: string,
  album?: string,
  signal?: AbortSignal,
  artistAlbumHint?: string,
  artworkAssets?: ArtworkAssetsApi,
): Promise<string | null> => {
  if (kind === 'artist') {
    if (!artworkAssets) return null;
    return findArtistArtworkUrl(artist, artworkAssets, artistAlbumHint, signal);
  }
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
    .map(item => {
      const artistScore = matchArtistScore(item.artistName || '', artist);
      const albumScore = matchScore(item.collectionName || '', album || '');
      return { item, artistScore, albumScore, score: artistScore + albumScore };
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  // Local files often contain shortened artist/album names or soundtrack
  // suffixes. Accept a strong match on either field so artwork lookup does
  // not fail just because the other metadata differs slightly.
  const minimumScore = 3;
  if (!best || best.score < minimumScore || !best.item.artworkUrl100) return null;
  if (best.artistScore >= 3 && best.albumScore >= 3) {
    recordArtistIdEvidence(artist, best.item.artistName || '', best.item.artistId);
  }
  return toLargeArtworkUrl(best.item.artworkUrl100);
};

export const getCachedArtwork = (kind: ArtworkKind, artist: string, album?: string) =>
  memoryCache.get(keyFor(kind, artist, album)) ?? readCache()[keyFor(kind, artist, album)] ?? null;

export const clearArtworkCache = (artworkAssets: ArtworkAssetsApi) => {
  cacheGeneration += 1;
  memoryCache.clear();
  discordUrlCache.clear();
  missingArtwork.clear();
  pending.clear();
  artistIdEvidence.clear();
  diskCache = {};
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(DISCORD_URL_CACHE_KEY);
    localStorage.removeItem(ARTIST_MATCH_VERSION_KEY);
    LEGACY_CACHE_KEYS.forEach(key => localStorage.removeItem(key));
  } catch { /* storage unavailable */ }
  void artworkAssets.clearRemoteArtworkCache().catch(() => undefined);
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
      setBoundedMap(discordUrlCache, key, stored[key], DISCORD_CACHE_LIMIT);
      return stored[key];
    }
    const url = await findITunesArtworkUrl('album', artist, album);
    if (!url) return null;
    setBoundedMap(discordUrlCache, key, url, DISCORD_CACHE_LIMIT);
    try { localStorage.setItem(DISCORD_URL_CACHE_KEY, JSON.stringify({ ...stored, [key]: url })); } catch { /* storage quota */ }
    return url;
  } catch {
    return null;
  }
};

export const downloadArtwork = async (
  kind: ArtworkKind,
  artist: string,
  album: string | undefined,
  artworkAssets: ArtworkAssetsApi,
  signal?: AbortSignal,
  artistAlbumHint?: string,
): Promise<string | null> => {
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
      const rawUrl = await findITunesArtworkUrl(kind, artist, album, signal, artistAlbumHint, artworkAssets);
      if (!rawUrl) {
        if (requestGeneration === cacheGeneration) {
          addBoundedSet(missingArtwork, key, MISSING_ARTWORK_LIMIT);
        }
        return null;
      }
      const downloaded = await toDataUrl(rawUrl, signal);
      signal?.throwIfAborted();
      const cachedSource = await persistArtwork(key, downloaded, artworkAssets);
      signal?.throwIfAborted();
      if (requestGeneration !== cacheGeneration) return cachedSource;
      setBoundedMap(memoryCache, key, cachedSource, MEMORY_CACHE_LIMIT);
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

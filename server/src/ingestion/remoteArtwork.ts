export type FetchLike = typeof fetch;

export interface RemoteArtworkLookup {
  lookupAlbumCover(artist: string, album: string): Promise<string | null>;
  lookupArtistPortrait(artist: string, albumHint?: string): Promise<string | null>;
}

interface ITunesAlbumResult {
  wrapperType?: string;
  artistId?: number;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

interface ITunesSearchResponse {
  results?: ITunesAlbumResult[];
}

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const DEFAULT_COUNTRY = 'vn';
const DEFAULT_TIMEOUT_MS = 7_500;
const HTML_TIMEOUT_MS = 8_000;
const JSON_MAX_BYTES = 512_000;
const HTML_MAX_BYTES = 1_500_000;
const MIN_MATCH_SCORE = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; NgheNhacProMax/1.0)';
const PARENTHETICAL_ARTIST = /[（(]([^()（）]+)[)）]/g;

export function toLargeArtworkUrl(url: string): string {
  return url
    .replace(/\/\{w\}x\{h\}\{c\}\.\{f\}$/i, '/600x600bb.png')
    .replace(/\/\d+x\d+(?:bb|cc|cw|ss|vb|vn)?(?:-\d+)?([.-])/i, '/600x600bb$1')
    .replace(/^http:/i, 'https:');
}

export function isArtistPortraitUrl(url: string): boolean {
  if (!isAllowedArtworkUrl(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.includes('/features') || path.includes('/amcartistimages');
  } catch {
    return false;
  }
}

export function isItunesAlbumArtworkUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().includes('/image/thumb/music');
  } catch {
    return false;
  }
}

export function artworkUrlsMatch(left: string, right: string): boolean {
  const normalize = (value: string) => toLargeArtworkUrl(value).split('?')[0]!.toLowerCase();
  return normalize(left) === normalize(right);
}

export function isAllowedArtworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'mzstatic.com'
      || host.endsWith('.mzstatic.com')
      || host === 'apple.com'
      || host.endsWith('.apple.com');
  } catch {
    return false;
  }
}

export function normalizeArtworkName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function artworkNameScore(found: string, expected: string): number {
  const actual = normalizeArtworkName(found);
  const target = normalizeArtworkName(expected);
  if (!actual || !target) return 0;
  if (actual === target) return 5;
  return actual.includes(target) || target.includes(actual) ? 3 : 0;
}

export function artworkArtistScore(found: string, expected: string): number {
  if (artistsShareIdentity(found, expected)) return 5;
  return artworkNameScore(found, expected);
}

export function parseAppleMusicArtistHtml(html: string): string | null {
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const image = musicGroupImage(JSON.parse(match[1]!.trim()));
      const url = asPortraitUrl(image);
      if (url) return url;
    } catch {
      // Ignore malformed JSON-LD blocks and keep scanning.
    }
  }
  const header = serializedArtistHeaderUrl(html);
  if (header) return header;
  // og:image on artist pages is often the current album. Only keep it when
  // Apple already tagged it as a Features / AMCArtistImages portrait.
  return asPortraitUrl(metaContent(html, 'og:image'));
}

export class FakeRemoteArtworkLookup implements RemoteArtworkLookup {
  albumUrl: string | null = 'https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg';
  artistUrl: string | null = 'https://is1-ssl.mzstatic.com/image/thumb/Features/artist.jpg';
  calls: Array<{ kind: 'album' | 'artist'; artist: string; album?: string }> = [];

  async lookupAlbumCover(artist: string, album: string): Promise<string | null> {
    this.calls.push({ kind: 'album', artist, album });
    return this.albumUrl;
  }

  async lookupArtistPortrait(artist: string, albumHint?: string): Promise<string | null> {
    this.calls.push({ kind: 'artist', artist, album: albumHint });
    return this.artistUrl;
  }
}

export class ITunesRemoteArtworkLookup implements RemoteArtworkLookup {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly options: { country?: string; timeoutMs?: number } = {},
  ) {}

  async lookupAlbumCover(artist: string, album: string): Promise<string | null> {
    const match = await this.bestAlbumMatch(artist, album);
    return match?.artworkUrl100 ? sanitizeArtworkUrl(toLargeArtworkUrl(match.artworkUrl100)) : null;
  }

  async lookupArtistPortrait(artist: string, albumHint?: string): Promise<string | null> {
    const match = await this.findArtist(artist, albumHint);
    if (!match?.artistId) return null;
    const portrait = await this.fetchAppleMusicPortrait(match.artistId);
    return portrait;
  }

  private async bestAlbumMatch(artist: string, album: string): Promise<ITunesAlbumResult | null> {
    const search = await this.searchITunes({
      term: `${artist} ${album}`.trim(),
      media: 'music',
      entity: 'album',
      country: this.country(),
      limit: '25',
    });
    const candidates = (search.results ?? [])
      .filter(item => item.artworkUrl100 && item.artistName)
      .map(item => {
        const artistScore = artworkArtistScore(item.artistName || '', artist);
        const albumScore = artworkNameScore(item.collectionName || '', album);
        return { item, score: artistScore + albumScore };
      })
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best || best.score < MIN_MATCH_SCORE) return null;
    return best.item;
  }

  private async findArtist(artist: string, albumHint?: string): Promise<ITunesAlbumResult | null> {
    if (albumHint?.trim()) {
      const fromAlbum = await this.findArtistViaAlbumSearch(
        `${artist} ${albumHint}`.trim(),
        artist,
        albumHint,
      );
      if (fromAlbum) return fromAlbum;
    }

    const fromName = await this.findArtistViaArtistSearch(artist);
    if (fromName) return fromName;

    return this.findArtistViaAlbumSearch(artist, artist);
  }

  private async findArtistViaArtistSearch(artist: string): Promise<ITunesAlbumResult | null> {
    for (const country of this.countries()) {
      for (const useArtistTerm of [true, false]) {
        const params: Record<string, string> = {
          term: artist,
          media: 'music',
          entity: 'musicArtist',
          country,
          limit: '10',
        };
        if (useArtistTerm) params.attribute = 'artistTerm';
        const search = await this.searchITunes(params);
        const ranked = (search.results ?? [])
          .filter(item => item.artistId && item.artistName)
          .map(item => ({ item, score: artworkArtistScore(item.artistName || '', artist) }))
          .sort((left, right) => right.score - left.score);
        const best = ranked[0];
        if (best && best.score >= MIN_MATCH_SCORE) return best.item;
      }
    }
    return null;
  }

  private async findArtistViaAlbumSearch(
    term: string,
    artist: string,
    albumHint?: string,
  ): Promise<ITunesAlbumResult | null> {
    for (const country of this.countries()) {
      const search = await this.searchITunes({
        term,
        media: 'music',
        entity: 'album',
        country,
        limit: '25',
      });
      const albumCandidates = (search.results ?? [])
        .filter(item => item.artistId && item.artistName && item.collectionName)
        .map(item => ({
          item,
          artistScore: artworkArtistScore(item.artistName || '', artist),
          albumScore: albumHint ? artworkNameScore(item.collectionName || '', albumHint) : 0,
        }))
        .sort((left, right) =>
          (right.artistScore + right.albumScore) - (left.artistScore + left.albumScore),
        );

      const namedMatch = albumCandidates.find(candidate =>
        candidate.artistScore >= MIN_MATCH_SCORE
        && (!albumHint || candidate.albumScore >= MIN_MATCH_SCORE),
      )?.item ?? null;
      if (namedMatch) return namedMatch;

      const strongArtistCandidates = albumCandidates.filter(candidate => candidate.artistScore >= MIN_MATCH_SCORE);
      const artistIds = new Set(strongArtistCandidates.map(candidate => candidate.item.artistId));
      if (artistIds.size === 1) return strongArtistCandidates[0]?.item ?? null;
    }
    return null;
  }

  private async fetchAppleMusicPortrait(artistId: number): Promise<string | null> {
    for (const country of this.countries()) {
      const html = await this.getText(
        `https://music.apple.com/${country}/artist/${artistId}`,
        HTML_MAX_BYTES,
        { Accept: 'text/html', 'User-Agent': USER_AGENT },
        HTML_TIMEOUT_MS,
      );
      if (!html) continue;
      const parsed = parseAppleMusicArtistHtml(html);
      const url = parsed ? sanitizeArtworkUrl(parsed) : null;
      if (url) return url;
    }
    return null;
  }

  private async searchITunes(params: Record<string, string>): Promise<ITunesSearchResponse> {
    return (await this.getJson<ITunesSearchResponse>(`${ITUNES_SEARCH_URL}?${new URLSearchParams(params)}`))
      ?? { results: [] };
  }

  private async getJson<T>(url: string): Promise<T | null> {
    const raw = await this.getText(url, JSON_MAX_BYTES, { Accept: 'application/json' });
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async getText(
    url: string,
    maxBytes: number,
    headers: Record<string, string>,
    timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<string | null> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const lengthHeader = response.headers.get('content-length');
      if (lengthHeader && Number(lengthHeader) > maxBytes) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) return null;
      return buffer.toString('utf8');
    } catch {
      return null;
    }
  }

  private country(): string {
    const value = (this.options.country ?? DEFAULT_COUNTRY).trim().toLowerCase();
    return /^[a-z]{2}$/.test(value) ? value : DEFAULT_COUNTRY;
  }

  private countries(): string[] {
    const primary = this.country();
    return primary === 'us' ? ['us'] : [primary, 'us'];
  }
}

export function createITunesRemoteArtworkLookup(fetchImpl: FetchLike = fetch): RemoteArtworkLookup {
  return new ITunesRemoteArtworkLookup(fetchImpl);
}

function sanitizeArtworkUrl(url: string): string | null {
  return isAllowedArtworkUrl(url) ? url : null;
}

function asPortraitUrl(url: string | null | undefined): string | null {
  if (!url?.startsWith('https://')) return null;
  const large = toLargeArtworkUrl(url);
  return isArtistPortraitUrl(large) ? large : null;
}

function serializedArtistHeaderUrl(html: string): string | null {
  const match = html.match(/<script\b[^>]*id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    return findArtistHeaderArtwork(JSON.parse(match[1].trim()));
  } catch {
    return null;
  }
}

function findArtistHeaderArtwork(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArtistHeaderArtwork(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (id.startsWith('artist-detail-header')) {
    const artwork = record.artwork && typeof record.artwork === 'object'
      ? record.artwork as Record<string, unknown>
      : null;
    const dictionary = artwork?.dictionary && typeof artwork.dictionary === 'object'
      ? artwork.dictionary as Record<string, unknown>
      : artwork;
    const url = typeof dictionary?.url === 'string' ? dictionary.url : null;
    const portrait = asPortraitUrl(url);
    if (portrait) return portrait;
  }
  for (const nested of Object.values(record)) {
    const found = findArtistHeaderArtwork(nested);
    if (found) return found;
  }
  return null;
}

function schemaTypeIs(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  return Array.isArray(value) && value.includes(expected);
}

function schemaImageUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('https://')) return value;
  if (Array.isArray(value)) {
    const urls: string[] = [];
    for (const item of value) {
      const found = schemaImageUrl(item);
      if (found) urls.push(found);
    }
    return urls.find(url => url.toLowerCase().includes('/amcartistimages'))
      ?? urls.find(url => url.toLowerCase().includes('/features'))
      ?? null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return schemaImageUrl(record.url) ?? schemaImageUrl(record.contentUrl);
  }
  return null;
}

function musicGroupImage(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = musicGroupImage(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (schemaTypeIs(record['@type'], 'MusicGroup') || schemaTypeIs(record['@type'], 'Person')) {
      return schemaImageUrl(record.image);
    }
    for (const nested of Object.values(record)) {
      const found = musicGroupImage(nested);
      if (found) return found;
    }
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  const tags = html.matchAll(/<meta\b[^>]*>/gi);
  for (const tag of tags) {
    const attrs: Array<[string, string]> = [...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/gi)]
      .map((match) => [match[1]!.toLowerCase(), match[2]!]);
    const isMatch = attrs.some(([name, value]) =>
      (name === 'property' || name === 'name') && value.toLowerCase() === property.toLowerCase(),
    );
    if (!isMatch) continue;
    const content = attrs.find(([name]) => name === 'content')?.[1];
    if (!content) continue;
    const decoded = content.replace(/&amp;/g, '&');
    if (decoded.startsWith('https://')) return decoded;
  }
  return null;
}

function normalizeArtistIdentity(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function hasLatinLetters(value: string): boolean {
  return /\p{Script=Latin}/u.test(value);
}

function hasNonLatinLetters(value: string): boolean {
  return /\p{L}/u.test(value) && !hasLatinLetters(value);
}

function hasVerifiableParentheticalAlias(base: string, alias: string): boolean {
  const baseHasLatin = hasLatinLetters(base);
  const aliasHasLatin = hasLatinLetters(alias);
  const baseHasNonLatin = hasNonLatinLetters(base);
  const aliasHasNonLatin = hasNonLatinLetters(alias);
  return (baseHasLatin && aliasHasNonLatin) || (baseHasNonLatin && aliasHasLatin);
}

function artistIdentityKeys(value: string): string[] {
  const keys = new Set<string>();
  const add = (part: string) => {
    const normalized = normalizeArtistIdentity(part);
    if (normalized.length >= 2) keys.add(normalized);
  };
  add(value);
  const matches = [...value.matchAll(PARENTHETICAL_ARTIST)];
  if (matches.length === 1) {
    const alias = matches[0]![1];
    const base = value.replace(PARENTHETICAL_ARTIST, ' ');
    if (alias && hasVerifiableParentheticalAlias(base, alias)) {
      add(base);
      add(alias);
    }
  }
  return [...keys];
}

function artistsShareIdentity(left: string, right: string): boolean {
  const rightKeys = new Set(artistIdentityKeys(right));
  return artistIdentityKeys(left).some(key => rightKeys.has(key));
}

import type { AppConfig } from '../config/env.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import type { LyricsProvider, LyricsProviderRequest, LyricsProviderResult } from './provider.js';
import { selectBestLyricsCandidate, type LyricsRankCandidate } from './rank.js';

export type FetchLike = typeof fetch;

interface LrclibPayload extends LyricsRankCandidate {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const PROVIDER_USER_AGENT = 'NgheNhacProMax/2.0 (cloud lyrics resolver)';

export class LrclibProvider implements LyricsProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async resolve(request: LyricsProviderRequest): Promise<LyricsProviderResult | null> {
    const url = new URL('/api/search', this.config.lyricsProviderUrl);
    url.searchParams.set('track_name', request.title);
    url.searchParams.set('artist_name', request.artist);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': PROVIDER_USER_AGENT,
        },
        signal: AbortSignal.timeout(this.config.lyricsProviderTimeoutMs),
      });
    } catch (error) {
      throw providerError(error);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider request failed.', false);
    }

    const raw = await readLimited(response, this.config.lyricsProviderMaxBytes);
    const candidates = parseCandidates(raw);
    const selected = selectBestLyricsCandidate(candidates, {
      title: request.title,
      artist: request.artist,
      album: request.album,
      durationSeconds: request.durationSeconds,
      genre: request.genre,
      language: request.language,
    });
    if (!selected) return null;

    return {
      instrumental: selected.instrumental === true,
      syncedLrc: selected.syncedLyrics ?? null,
      plainText: selected.plainLyrics ?? null,
      source: 'lrclib',
      title: selected.trackName ?? undefined,
      artist: selected.artistName ?? undefined,
      album: selected.albumName ?? undefined,
    };
  }
}

function parseCandidates(raw: string): LyricsRankCandidate[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider returned invalid JSON.', false);
  }

  const records = Array.isArray(payload)
    ? payload
    : isLyricsRecord(payload)
      ? [payload]
      : null;
  if (!records) {
    throw new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider returned invalid JSON.', false);
  }

  return records.filter(isLyricsRecord).map((record) => ({
    id: typeof record.id === 'number' ? record.id : undefined,
    trackName: optionalString(record.trackName),
    artistName: optionalString(record.artistName),
    albumName: optionalString(record.albumName),
    duration: typeof record.duration === 'number' ? record.duration : null,
    instrumental: record.instrumental === true,
    plainLyrics: optionalString(record.plainLyrics),
    syncedLyrics: optionalString(record.syncedLyrics),
    lang: optionalString(record.lang ?? record.language),
  }));
}

function isLyricsRecord(value: unknown): value is LrclibPayload & Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    throw new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider response is too large.', false);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider response is too large.', false);
  }
  return buffer.toString('utf8');
}

function providerError(error: unknown): AppError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider timed out.', false);
  }
  return new AppError(502, ErrorCodes.LYRICS_PROVIDER_ERROR, 'Lyrics provider request failed.', false);
}

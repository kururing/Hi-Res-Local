import { CloudApiClient, CloudApiError } from '../../api/client';
import { normalizeLyricsData } from '../../services/lrc';
import type { LyricsApi, RemoteLyricsRequest, TrackLyrics } from '../contracts';

interface CloudLyricLine {
  timestamp?: number;
  timestamp_seconds?: number;
  timestamp_ms?: number;
  text?: string;
  romanized?: string;
  translation?: string;
}

interface CloudLyricsBody {
  is_synced?: boolean;
  lines?: CloudLyricLine[];
  plain_text?: string;
  source?: string;
  romanized?: CloudLyricsBody;
  instrumental?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  offset?: number;
  not_found?: boolean;
  status?: string;
  lyrics?: CloudLyricsBody | null;
  data?: CloudLyricsBody | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFoundStatus(status: number): boolean {
  return status === 404;
}

function unwrapLyricsPayload(payload: unknown): unknown {
  if (payload == null) return null;
  if (!isRecord(payload)) return payload;
  if (payload.not_found === true || payload.status === 'not_found') return null;
  if (isLyricsShape(payload)) return payload;
  if ('lyrics' in payload) return payload.lyrics;
  if ('data' in payload) return payload.data;
  return payload;
}

function isLyricsShape(value: Record<string, unknown>): boolean {
  if (value.instrumental === true) return true;
  if ('lines' in value) return true;
  if ('plain_text' in value) return true;
  if (typeof value.is_synced === 'boolean') return true;
  return false;
}

function toIpcLikeLine(line: CloudLyricLine): {
  timestamp?: number;
  timestamp_ms?: number;
  text?: string;
  romanized?: string;
  translation?: string;
} {
  const timestamp = typeof line.timestamp_seconds === 'number'
    ? line.timestamp_seconds
    : line.timestamp;
  return {
    timestamp,
    timestamp_ms: line.timestamp_ms,
    text: line.text,
    romanized: line.romanized,
    translation: line.translation,
  };
}

function sanitizeCloudLyrics(payload: unknown): TrackLyrics | null {
  const unwrapped = unwrapLyricsPayload(payload);
  if (unwrapped == null) return null;
  if (!isRecord(unwrapped)) {
    throw new Error('Cloud lyrics response was not an object.');
  }
  if (!isLyricsShape(unwrapped)) {
    throw new Error('Cloud lyrics response was missing a lyrics payload.');
  }
  if ('lines' in unwrapped && unwrapped.lines !== undefined && !Array.isArray(unwrapped.lines)) {
    throw new Error('Cloud lyrics lines were not an array.');
  }
  if ('plain_text' in unwrapped && unwrapped.plain_text != null && typeof unwrapped.plain_text !== 'string') {
    throw new Error('Cloud lyrics plain_text was not a string.');
  }

  const body = unwrapped as CloudLyricsBody;
  const normalized = normalizeLyricsData({
    is_synced: body.is_synced,
    lines: Array.isArray(body.lines) ? body.lines.map(toIpcLikeLine) : [],
    plain_text: body.plain_text,
    source: body.source,
    romanized: body.romanized,
    instrumental: body.instrumental,
    title: body.title,
    artist: body.artist,
    album: body.album,
    by: body.by,
    offset: body.offset,
  });
  if (!normalized) return null;

  const hasText = Boolean(normalized.plain_text?.trim())
    || normalized.lines.length > 0
    || Boolean(normalized.romanized?.plain_text?.trim())
    || Boolean(normalized.romanized?.lines.length);
  if (!hasText && !normalized.instrumental) return null;
  return normalized;
}

async function readCloudLyrics(request: Promise<unknown>): Promise<TrackLyrics | null> {
  try {
    return sanitizeCloudLyrics(await request);
  } catch (error) {
    if (error instanceof CloudApiError && isNotFoundStatus(error.status)) return null;
    throw error;
  }
}

/**
 * Browser cloud runtime. Lyrics reads go through CloudApiClient so the
 * browser never calls LRCLIB (or any other provider) directly.
 */
export class WebLyricsApi implements LyricsApi {
  constructor(private readonly cloud: CloudApiClient) {}

  getTrackLyrics(trackId: string): Promise<TrackLyrics | null> {
    return readCloudLyrics(
      this.cloud.request<CloudLyricsBody | null>(
        `/v1/tracks/${encodeURIComponent(trackId)}/lyrics`
      )
    );
  }

  fetchRemoteLyrics(request: RemoteLyricsRequest): Promise<TrackLyrics | null> {
    return readCloudLyrics(
      this.cloud.request<CloudLyricsBody | null>('/v1/lyrics/resolve', {
        method: 'POST',
        body: {
          track_id: request.trackId,
          title: request.title,
          artist: request.artist,
          album: request.album,
          duration_seconds: request.durationSeconds,
        },
      })
    );
  }
}

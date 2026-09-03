import { CloudApiError } from '../api/client';

export type PlaybackErrorCode =
  | 'AUTOPLAY_BLOCKED'
  | 'UNSUPPORTED_FORMAT'
  | 'NETWORK'
  | 'DECODE'
  | 'SOURCE_UNAVAILABLE'
  | 'SIGNED_URL_EXPIRED'
  | 'QUALITY_UNAVAILABLE'
  | 'AUTH_EXPIRED'
  | 'REQUEST_ABORTED'
  | 'RANGE_REQUIRED'
  | 'BOUNDED_FALLBACK'
  | 'PLAYBACK';

export class PlaybackError extends Error {
  readonly code: PlaybackErrorCode;
  readonly expected: boolean;

  constructor(code: PlaybackErrorCode, message: string, expected = false) {
    super(message);
    this.name = 'PlaybackError';
    this.code = code;
    this.expected = expected;
  }
}

export const PLAYBACK_ERROR_MESSAGES: Record<PlaybackErrorCode, string> = {
  AUTOPLAY_BLOCKED: 'Autoplay was blocked by the browser',
  UNSUPPORTED_FORMAT: 'This browser cannot play the selected audio format',
  NETWORK: 'The audio stream could not be loaded',
  DECODE: 'The browser could not decode this audio stream',
  SOURCE_UNAVAILABLE: 'No playable audio source is available',
  SIGNED_URL_EXPIRED: 'The signed audio URL expired',
  QUALITY_UNAVAILABLE: 'The requested stream quality is not available',
  AUTH_EXPIRED: 'Your session expired. Sign in again to play music',
  REQUEST_ABORTED: 'Stream request aborted because the track changed',
  RANGE_REQUIRED: 'This hi-res file cannot stream because the server did not honor HTTP Range',
  BOUNDED_FALLBACK: 'This codec cannot stream by Range and the file exceeds the bounded fallback limit',
  PLAYBACK: 'This audio file could not be played.',
};

export function isExpectedPlaybackAbort(error: unknown): boolean {
  if (error instanceof PlaybackError) return error.expected || error.code === 'REQUEST_ABORTED';
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return error instanceof Error && (error.name === 'AbortError' || /aborted because the track changed/i.test(error.message));
}

export function playbackError(code: PlaybackErrorCode, expected = false): PlaybackError {
  return new PlaybackError(code, PLAYBACK_ERROR_MESSAGES[code], expected);
}

export function normalizePlaybackError(
  error: unknown,
  options: { signedUrlExpired?: boolean } = {}
): PlaybackError {
  if (error instanceof PlaybackError) return error;
  if (isExpectedPlaybackAbort(error)) return playbackError('REQUEST_ABORTED', true);

  if (error instanceof CloudApiError) {
    if (error.status === 401 || error.code?.startsWith('AUTH_')) {
      return playbackError('AUTH_EXPIRED');
    }
    if (error.code === 'STREAM_QUALITY_UNAVAILABLE') return playbackError('QUALITY_UNAVAILABLE');
    if (error.code === 'STREAM_FORMAT_UNSUPPORTED') return playbackError('UNSUPPORTED_FORMAT');
    if (
      error.code === 'STREAM_ASSET_UNAVAILABLE'
      || error.code === 'STREAM_TRACK_UNAVAILABLE'
    ) {
      return playbackError('SOURCE_UNAVAILABLE');
    }
  }

  if (error instanceof Error && error.name === 'NotAllowedError') {
    return playbackError('AUTOPLAY_BLOCKED');
  }
  if (error instanceof Error && error.name === 'NotSupportedError') {
    return playbackError('UNSUPPORTED_FORMAT');
  }

  if (error instanceof TypeError && /fetch|network|load/i.test(error.message)) {
    return playbackError('NETWORK');
  }

  if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError) {
    return playbackError('DECODE');
  }

  const mediaCode = mediaErrorCode(error);
  if (mediaCode === 4) return playbackError('UNSUPPORTED_FORMAT');
  if (mediaCode === 3) return playbackError('DECODE');
  if (mediaCode === 2) {
    return playbackError(options.signedUrlExpired ? 'SIGNED_URL_EXPIRED' : 'NETWORK');
  }
  if (mediaCode === 1) return playbackError('REQUEST_ABORTED', true);

  return playbackError('PLAYBACK');
}

function mediaErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error == null) return null;
  if ('code' in error && typeof (error as { code: unknown }).code === 'number') {
    return (error as { code: number }).code;
  }
  if ('error' in error) {
    const nested = (error as { error?: { code?: unknown } }).error;
    if (nested && typeof nested.code === 'number') return nested.code;
  }
  return null;
}

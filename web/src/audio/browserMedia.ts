import type { Track } from '../types/library';
import type { StreamDescriptor } from '../platform/streaming/types';

export interface BrowserMediaElement {
  src: string;
  preload: string;
  playsInline: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  error: { code: number; message?: string } | null;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export const SIGNED_URL_EXPIRY_SKEW_MS = 15_000;

export function configureBrowserMedia(media: BrowserMediaElement): BrowserMediaElement {
  media.preload = 'metadata';
  media.playsInline = true;
  return media;
}

export function createBrowserAudioElement(): BrowserMediaElement {
  const element = typeof Audio !== 'undefined'
    ? new Audio()
    : typeof document !== 'undefined'
      ? document.createElement('audio')
      : null;
  if (!element) {
    throw new Error('HTMLAudioElement is not available in this runtime.');
  }
  // TypeScript's DOM lib types HTMLAudioElement without playsInline.
  return configureBrowserMedia(element as HTMLAudioElement & BrowserMediaElement);
}

export function clampMediaVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.max(0, Math.min(1, volume));
}

export function finiteMediaDuration(value: number | undefined | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function resolvePlaybackDuration(
  mediaDuration: number | undefined | null,
  track: Track | null
): number {
  return finiteMediaDuration(mediaDuration)
    ?? finiteMediaDuration(track?.duration)
    ?? finiteMediaDuration(track?.duration_ms != null ? track.duration_ms / 1000 : null)
    ?? 0;
}

export function clampPlaybackPosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return position;
  return Math.min(position, duration);
}

export function isSignedUrlExpiredOrNear(
  expiresAt: string,
  now: number,
  skewMs = SIGNED_URL_EXPIRY_SKEW_MS
): boolean {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return true;
  return expires - now <= skewMs;
}

export function withStreamPresentation(track: Track, descriptor: StreamDescriptor): Track {
  const bitDepth = descriptor.asset.bitDepth;
  return {
    ...track,
    format: descriptor.asset.container.toUpperCase() || track.format,
    sample_rate: descriptor.asset.sampleRateHz,
    bit_depth: bitDepth,
    bits_per_sample: bitDepth ?? undefined,
    channels: descriptor.asset.channels,
    bitrate: descriptor.asset.bitrateKbps ?? undefined,
  };
}

export function mergeTrackPresentation(base: Track, source: Track): Track {
  return {
    ...base,
    format: source.format ?? base.format,
    sample_rate: source.sample_rate ?? base.sample_rate,
    bit_depth: source.bit_depth ?? base.bit_depth,
    bits_per_sample: source.bits_per_sample ?? source.bit_depth ?? base.bits_per_sample,
    channels: source.channels ?? base.channels,
    bitrate: source.bitrate ?? base.bitrate,
  };
}

export function waitForMediaReady(
  media: BrowserMediaElement,
  isCurrent: () => boolean,
  signal?: AbortSignal
): Promise<void> {
  if (finiteMediaDuration(media.duration) != null) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const finish = (error?: unknown) => {
      media.removeEventListener('loadedmetadata', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };

    const onReady = () => {
      if (!isCurrent()) {
        finish(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      finish();
    };
    const onError = () => finish(media.error ?? new Error('Media failed to load.'));
    const onAbort = () => finish(new DOMException('The operation was aborted.', 'AbortError'));

    if (signal?.aborted) {
      onAbort();
      return;
    }

    media.addEventListener('loadedmetadata', onReady);
    media.addEventListener('canplay', onReady);
    media.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
  });
}

export function resetMediaSource(media: BrowserMediaElement): void {
  media.pause();
  media.src = '';
  media.load();
}

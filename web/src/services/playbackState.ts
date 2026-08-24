import { Track } from '../types/library';

export interface LastPlayback {
  trackId: string | null;
  position: number;
}

export interface RestoredPlayback {
  track: Track;
  position: number;
  queueIndex: number;
}

export interface PlaybackProgress {
  position: number;
  duration: number;
}

export function clampPlaybackPosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return position;
  return Math.min(position, duration);
}

export function normalizePlaybackProgress(
  position: number,
  reportedDuration: number | undefined,
  currentDuration: number
): PlaybackProgress {
  const duration = Number.isFinite(reportedDuration) && (reportedDuration ?? 0) > 0
    ? reportedDuration as number
    : currentDuration;

  return {
    duration,
    position: clampPlaybackPosition(position, duration),
  };
}

export function restoreLastPlayback(
  tracks: Track[],
  last: LastPlayback
): RestoredPlayback | null {
  if (!last.trackId) return null;

  const queueIndex = tracks.findIndex(track => track.id === last.trackId);
  if (queueIndex < 0) return null;

  const track = tracks[queueIndex];
  return {
    track,
    position: clampPlaybackPosition(last.position, track.duration),
    queueIndex,
  };
}

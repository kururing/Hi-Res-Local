import { Track } from '../types/library';

export const BEFORE_APP_QUIT_EVENT = 'nghenhac:before-app-quit';

export interface LastPlayback {
  trackId: string | null;
  position: number;
}

export interface BackendSavedPlayback {
  track_id: string;
  position_ms: number;
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

export function backendPlaybackToLastPlayback(
  saved: BackendSavedPlayback | null
): LastPlayback | null {
  if (!saved?.track_id || !Number.isFinite(saved.position_ms) || saved.position_ms < 0) {
    return null;
  }
  return {
    trackId: saved.track_id,
    position: saved.position_ms / 1000,
  };
}

export function shouldIgnoreEarlyResumePosition(
  reportedPosition: number,
  targetPosition: number,
  elapsedMs: number
): boolean {
  const minimumConfirmedPosition = Math.max(0.5, targetPosition - 5);
  return elapsedMs < 3000 && reportedPosition < minimumConfirmedPosition;
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

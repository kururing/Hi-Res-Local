import { AppError, ErrorCodes } from '../errors/appError.js';

export const IDEMPOTENCY_KEY_MAX = 128;
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

export function resolveIdempotencyKey(
  headerKey: string | undefined,
  bodyKey: string | undefined,
): string | null {
  const header = normalizeKey(headerKey);
  const body = normalizeKey(bodyKey);
  if (header && body && header !== body) {
    throw new AppError(
      400,
      ErrorCodes.HISTORY_IDEMPOTENCY_MISMATCH,
      'Idempotency-Key and client_request_id must match when both are present.',
    );
  }
  return header ?? body;
}

export function assertCompletedDuration(completedMs: number, trackDurationSeconds: number): void {
  if (!Number.isFinite(completedMs) || completedMs < 0) {
    throw new AppError(400, ErrorCodes.HISTORY_DURATION_INVALID, 'completed_duration_ms cannot be negative.');
  }
  const durationMs = Math.round(trackDurationSeconds * 1000);
  const toleranceMs = Math.min(10_000, Math.max(2_000, Math.round(durationMs * 0.05)));
  if (completedMs > durationMs + toleranceMs) {
    throw new AppError(
      400,
      ErrorCodes.HISTORY_DURATION_INVALID,
      'completed_duration_ms exceeds the track duration.',
    );
  }
}

function normalizeKey(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > IDEMPOTENCY_KEY_MAX) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, `Idempotency key must be at most ${IDEMPOTENCY_KEY_MAX} characters.`);
  }
  return trimmed;
}

import { AppError, ErrorCodes } from '../errors/appError.js';

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string): T {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Invalid cursor.');
  }
}

export function parseLimit(raw: number | undefined, fallback: number, max: number): number {
  if (raw == null) return fallback;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'limit must be a positive integer.');
  }
  return Math.min(raw, max);
}

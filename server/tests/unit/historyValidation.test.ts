import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes } from '../../src/errors/appError.js';
import { assertCompletedDuration, resolveIdempotencyKey } from '../../src/history/validation.js';

describe('history validation', () => {
  it('requires matching header and body idempotency keys', () => {
    expect(resolveIdempotencyKey('abc', 'abc')).toBe('abc');
    expect(resolveIdempotencyKey('abc', undefined)).toBe('abc');
    expect(resolveIdempotencyKey(undefined, 'abc')).toBe('abc');
    expect(() => resolveIdempotencyKey('abc', 'xyz')).toThrow(AppError);
    try {
      resolveIdempotencyKey('abc', 'xyz');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCodes.HISTORY_IDEMPOTENCY_MISMATCH);
    }
  });

  it('rejects negative duration and values far above track length', () => {
    expect(() => assertCompletedDuration(-1, 214.5)).toThrow(AppError);
    expect(() => assertCompletedDuration(400_000, 214.5)).toThrow(AppError);
    expect(() => assertCompletedDuration(214_500, 214.5)).not.toThrow();
    expect(() => assertCompletedDuration(216_000, 214.5)).not.toThrow();
  });

  it('does not treat fully_played as a duration bypass because it is unused here', () => {
    expect(() => assertCompletedDuration(999_999, 10)).toThrow(AppError);
  });
});

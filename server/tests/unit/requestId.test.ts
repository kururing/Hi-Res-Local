import { describe, expect, it } from 'vitest';
import { sanitizeRequestId } from '../../src/http/requestId.js';

describe('sanitizeRequestId', () => {
  it('accepts a UUID v4 request id', () => {
    expect(sanitizeRequestId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('rejects log-injection and non-UUID values', () => {
    expect(sanitizeRequestId('req-contract-1')).toBeUndefined();
    expect(sanitizeRequestId('11111111-1111-4111-8111-111111111111\nX-Injected: 1')).toBeUndefined();
    expect(sanitizeRequestId(['11111111-1111-4111-8111-111111111111'])).toBeUndefined();
    expect(sanitizeRequestId('  11111111-1111-4111-8111-111111111111  ')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });
});

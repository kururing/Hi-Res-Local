import { describe, expect, it } from 'vitest';
import { ProbeError } from '../../src/ingestion/probe.js';

describe('ingestion retry policy', () => {
  it('retries only transient probe failures', () => {
    const timeout = new ProbeError('PROBE_TIMEOUT', 'timed out', true);
    const invalid = new ProbeError('PROBE_NO_AUDIO', 'invalid');
    expect(timeout.retryable).toBe(true);
    expect(invalid.retryable).toBe(false);
  });
});

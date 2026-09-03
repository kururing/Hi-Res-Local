import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/appError.js';
import { requireReconcilePrefixes } from '../../src/admin/importService.js';

describe('reconcile prefix allowlist', () => {
  it('requires at least one non-empty prefix', () => {
    expect(requireReconcilePrefixes(['ingestion/audio/'])).toEqual(['ingestion/audio/']);
    expect(() => requireReconcilePrefixes([])).toThrow(AppError);
    expect(() => requireReconcilePrefixes(['', '  '])).toThrow(/IMPORT_RECONCILE_PREFIXES/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertSafeDatabaseName,
  parseDatabaseUrl,
  replaceDatabaseName,
  toIntegrationDatabaseUrl,
} from '../integration/databaseUrl.js';

describe('integration database URL', () => {
  it('rewrites the app database to a sibling _test database', () => {
    expect(toIntegrationDatabaseUrl('postgres://nghenhac:nghenhac@127.0.0.1:5433/nghenhac'))
      .toBe('postgres://nghenhac:nghenhac@127.0.0.1:5433/nghenhac_test');
  });

  it('keeps an explicit test database and query string intact', () => {
    const url = 'postgresql://user:pass@db.example:5432/nghenhac_test?sslmode=disable';
    expect(toIntegrationDatabaseUrl(url)).toBe(url);
    expect(replaceDatabaseName(url, 'other_db'))
      .toBe('postgresql://user:pass@db.example:5432/other_db?sslmode=disable');
  });

  it('parses the database name and rejects blank paths', () => {
    expect(parseDatabaseUrl('postgres://nghenhac:nghenhac@127.0.0.1:5433/nghenhac').name).toBe('nghenhac');
    expect(() => parseDatabaseUrl('postgres://nghenhac:nghenhac@127.0.0.1:5433/')).toThrow(/database name/);
    expect(assertSafeDatabaseName('nghenhac_test')).toBe('nghenhac_test');
    expect(() => assertSafeDatabaseName('nghenhac-test')).toThrow(/simple PostgreSQL identifier/);
  });
});

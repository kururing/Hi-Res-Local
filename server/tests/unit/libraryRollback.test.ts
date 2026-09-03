import { describe, expect, it } from 'vitest';
import { redactSignedUrl } from '../../src/logging/redact.js';
import { type Queryable } from '../../src/db/types.js';
import { LibraryService, type TransactionRunner } from '../../src/library/service.js';
import { CatalogRepository } from '../../src/catalog/repository.js';
import type { Pool } from 'pg';

describe('redactSignedUrl', () => {
  it('strips signature query parameters', () => {
    const redacted = redactSignedUrl('https://storage.test/obj/key.flac?X-Amz-Signature=secret&X-Amz-Credential=AKIA');
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('AKIA');
    expect(redacted).toContain('[Redacted]');
  });
});

describe('LibraryService transaction control flow', () => {
  it('does not keep a library item when change logging fails', async () => {
    let itemPresent = false;
    const runTx: TransactionRunner = async (_pool, fn) => {
      const fakeDb = {
        async query(text: string) {
          if (text.includes('SELECT 1 FROM tracks') && text.includes("publication_state = 'published'")) {
            return { rowCount: 1, rows: [{}], command: 'SELECT', oid: 0, fields: [] };
          }
          if (text.includes('INSERT INTO user_library_tracks')) {
            itemPresent = true;
            return { rowCount: 1, rows: [], command: 'INSERT', oid: 0, fields: [] };
          }
          if (text.includes('INSERT INTO library_changes')) {
            throw new Error('change write failed');
          }
          return { rowCount: 0, rows: [], command: 'SELECT', oid: 0, fields: [] };
        },
      } as Queryable;
      try {
        return await fn(fakeDb);
      } catch (error) {
        itemPresent = false;
        throw error;
      }
    };

    const service = new LibraryService(
      {} as Pool,
      new CatalogRepository({} as Pool),
      runTx,
    );

    await expect(service.addTrack('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331'))
      .rejects.toThrow('change write failed');
    expect(itemPresent).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { redactAuditMetadata } from '../../src/admin/audit.js';

describe('admin audit redaction', () => {
  it('redacts signed URLs, credentials, cookies, and object keys', () => {
    const redacted = redactAuditMetadata({
      url: 'https://storage.test/put?sig=secret',
      token: 'abc',
      object_key: 'ingestion/audio/1',
      size_bytes: 12,
      nested: { cookie: 'a=b', ok: true },
    }) as Record<string, unknown>;
    expect(redacted.url).toBe('[Redacted]');
    expect(redacted.token).toBe('[Redacted]');
    expect(redacted.object_key).toBe('[Redacted]');
    expect(redacted.size_bytes).toBe(12);
    expect((redacted.nested as { cookie: string }).cookie).toBe('[Redacted]');
  });
});

import { describe, expect, it } from 'vitest';
import { MetricsRegistry, sanitizeRoute } from '../../src/observability/metrics.js';
import { loggerRedactPaths, redactSignedUrl } from '../../src/logging/redact.js';

describe('metrics and log redaction', () => {
  it('uses route templates and bounded labels', () => {
    const metrics = new MetricsRegistry();
    metrics.observeHttp('POST', '/v1/tracks/:trackId/stream', 200, 0.01);
    metrics.authFailure('AUTH_UNAUTHORIZED');
    metrics.signedStream('lossless');
    metrics.probeFailure('PROBE_NO_AUDIO');
    const text = metrics.render();
    expect(text).toContain('route="/v1/tracks/:trackId/stream"');
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}/i);
    expect(text).not.toContain('@');
    expect(metrics.containsSensitive()).toBe(false);
    expect(sanitizeRoute('/v1/tracks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/stream')).toBe('/v1/tracks/:id/stream');
  });

  it('redacts tokens, cookies, and signed URLs', () => {
    const paths = loggerRedactPaths();
    expect(paths).toContain('req.headers.authorization');
    expect(paths).toContain('req.headers.cookie');
    expect(paths).toContain('*.url');
    expect(redactSignedUrl('http://127.0.0.1:9000/bucket/key?X-Amz-Signature=secret')).toContain('[Redacted]');
    expect(redactSignedUrl('http://127.0.0.1:9000/bucket/key?X-Amz-Signature=secret')).not.toContain('secret');
  });
});

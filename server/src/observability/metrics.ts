import type { Pool } from 'pg';

const AUTH_CODES = new Set([
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_EMAIL_TAKEN',
  'AUTH_UNAUTHORIZED',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_INVALID',
  'AUTH_REFRESH_INVALID',
  'AUTH_REFRESH_REUSE',
  'AUTH_INVALID_ORIGIN',
  'RATE_LIMITED',
]);

const PROBE_CODES = new Set([
  'PROBE_TIMEOUT',
  'PROBE_SPAWN_FAILED',
  'PROBE_FAILED',
  'PROBE_PARSE_FAILED',
  'PROBE_NO_AUDIO',
  'PROBE_INVALID_DURATION',
  'PROBE_INVALID_RATE',
  'PROBE_INVALID_CHANNELS',
  'PROBE_UNSUPPORTED',
  'PROBE_OUTPUT_LIMIT',
  'NNPM_PROBE_MISSING',
  'UPLOAD_SIZE_MISMATCH',
  'UPLOAD_CHECKSUM_MISMATCH',
  'OBJECT_DOWNLOAD_FAILED',
  'INGESTION_FAILED',
]);

const QUALITIES = new Set(['auto', 'high', 'lossless', 'maximum', 'max', 'original', 'hires', 'compatible', 'data-saver']);
const JOB_STATUSES = new Set(['ready', 'failed', 'retried', 'cancelled']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const STATUS_CLASSES = new Set(['2xx', '4xx', '5xx', '3xx', '1xx']);

function bound(set: Set<string>, value: string, fallback = 'other'): string {
  return set.has(value) ? value : fallback;
}

function statusClass(code: number): string {
  return bound(STATUS_CLASSES, `${Math.trunc(code / 100)}xx`);
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly durations: Array<{ labels: string; value: number }> = [];

  increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  observe(name: string, labels: Record<string, string>, value: number): void {
    this.durations.push({ labels: this.key(name, labels), value });
    this.increment(`${name}_count`, labels);
    this.increment(`${name}_sum`, labels, value);
  }

  observeHttp(method: string, route: string, statusCode: number, seconds: number): void {
    const labels = {
      method: bound(HTTP_METHODS, method.toUpperCase()),
      route: sanitizeRoute(route),
      status_class: statusClass(statusCode),
    };
    this.observe('http_request_duration_seconds', labels, seconds);
  }

  authFailure(code: string): void {
    this.increment('auth_failures_total', { code: bound(AUTH_CODES, code) });
  }

  signedStream(quality: string): void {
    this.increment('signed_streams_issued_total', { quality: bound(QUALITIES, quality) });
  }

  streamUnavailable(): void {
    this.increment('stream_format_unavailable_total');
  }

  upload(event: 'initiated' | 'completed' | 'cancelled'): void {
    this.increment('uploads_total', { event });
  }

  ingestion(status: string, seconds: number): void {
    const bounded = bound(JOB_STATUSES, status);
    this.observe('ingestion_job_duration_seconds', { status: bounded }, seconds);
  }

  probeFailure(code: string): void {
    this.increment('probe_failures_total', { code: bound(PROBE_CODES, code) });
  }

  publish(action: 'publish' | 'unpublish'): void {
    this.increment('catalog_publication_total', { action });
  }

  render(extraGauges: Record<string, number> = {}): string {
    const lines: string[] = ['# TYPE nnpm_info gauge', 'nnpm_info 1'];
    for (const [key, value] of [...this.counters.entries()].sort()) {
      lines.push(`${key} ${formatNumber(value)}`);
    }
    for (const [name, value] of Object.entries(extraGauges)) {
      lines.push(`${name} ${formatNumber(value)}`);
    }
    return `${lines.join('\n')}\n`;
  }

  containsSensitive(): boolean {
    const text = this.render();
    return /user_id|track_id|filename|@|request_id|X-Amz-Signature/i.test(text);
  }

  private key(name: string, labels: Record<string, string>): string {
    const pairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${escapeLabel(v)}"`);
    return pairs.length ? `${name}{${pairs.join(',')}}` : name;
  }
}

export function sanitizeRoute(route: string): string {
  const path = route.split('?')[0] ?? '/';
  if (path.includes(':') || path.includes('{')) {
    return path.replace(/\/{2,}/g, '/').slice(0, 120);
  }
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/{2,}/g, '/')
    .slice(0, 120);
}

export async function workerQueueGauges(pool: Pool): Promise<Record<string, number>> {
  const pending = await pool.query<{ count: string; oldest: Date | string | null }>(`
    SELECT count(*)::text AS count,
           min(available_at) AS oldest
    FROM ingestion_jobs
    WHERE status = 'pending'
  `);
  const row = pending.rows[0];
  const count = Number(row?.count ?? 0);
  const oldest = row?.oldest ? new Date(row.oldest).getTime() : Date.now();
  const age = count > 0 ? Math.max(0, (Date.now() - oldest) / 1000) : 0;
  return {
    worker_queue_depth: count,
    worker_oldest_pending_age_seconds: age,
  };
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 80);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

export const defaultMetrics = new MetricsRegistry();

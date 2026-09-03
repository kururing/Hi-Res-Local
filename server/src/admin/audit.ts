import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types.js';
import { query } from '../db/types.js';

const REDACT_KEYS = new Set([
  'url',
  'presigned_url',
  'presignedUrl',
  'authorization',
  'cookie',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'secretAccessKey',
  'accessKeyId',
  'object_key',
  'objectKey',
  'storage_key',
  'storageKey',
]);

export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.has(key) ? '[Redacted]' : redactAuditMetadata(nested);
    }
    return out;
  }
  return value;
}

export async function writeAdminAudit(
  db: Queryable,
  input: {
    adminUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    requestId?: string | null;
    metadata?: unknown;
  },
): Promise<void> {
  await query(db, `
    INSERT INTO admin_audit_log (
      id, admin_user_id, action, entity_type, entity_id, request_id, metadata_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
  `, [
    randomUUID(),
    input.adminUserId,
    input.action,
    input.entityType,
    input.entityId ?? null,
    input.requestId ?? null,
    JSON.stringify(redactAuditMetadata(input.metadata ?? {})),
  ]);
}

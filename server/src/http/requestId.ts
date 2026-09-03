const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeRequestId(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const value = header.trim();
  return REQUEST_ID.test(value) ? value : undefined;
}

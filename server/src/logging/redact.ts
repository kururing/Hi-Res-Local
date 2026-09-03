export function loggerRedactPaths(): string[] {
  return [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["set-cookie"]',
    'res.headers["set-cookie"]',
    '*.password',
    '*.access_token',
    '*.refresh_token',
    '*.token',
    '*.plain_text',
    '*.plainLyrics',
    '*.syncedLyrics',
    '*.synced_lrc',
    '*.lines',
    '*.lines_json',
    '*.url',
    '*.presigned_url',
    '*.presignedUrl',
    '*.object_key',
    '*.objectKey',
    'req.headers["idempotency-key"]',
    '*.secretAccessKey',
    '*.accessKeyId',
    '*.X-Amz-Signature',
    '*.x-amz-signature',
    '*.X-Amz-Credential',
  ];
}

export function redactSignedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.toString()}?[Redacted]`;
  } catch {
    return '[Redacted]';
  }
}

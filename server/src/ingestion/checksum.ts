import { createHash } from 'node:crypto';

const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=?$/;

export function normalizeSha256(value: string): string {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith('sha256:') ? trimmed.slice(7) : trimmed;
  if (HEX_SHA256.test(withoutPrefix)) {
    return withoutPrefix.toLowerCase();
  }
  if (BASE64_SHA256.test(withoutPrefix)) {
    return Buffer.from(withoutPrefix, 'base64').toString('hex');
  }
  throw new Error('invalid_sha256');
}

export function tryNormalizeSha256(value: string): string | null {
  try {
    return normalizeSha256(value);
  } catch {
    return null;
  }
}

export function hexToChecksumBase64(hex: string): string {
  return Buffer.from(normalizeSha256(hex), 'hex').toString('base64');
}

export function sha256Hex(buffer: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function sha256HexFromStream(
  stream: AsyncIterable<unknown>,
  maxBytes: number,
): Promise<{ checksum: string; size: number } | null> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > maxBytes) return null;
    hash.update(buf);
  }
  if (size <= 0) return null;
  return { checksum: hash.digest('hex'), size };
}

export function isLikelyMultipartEtag(etag: string | null | undefined): boolean {
  if (!etag) return false;
  return /-\d+"?$/.test(etag);
}

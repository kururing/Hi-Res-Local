import { IncrementalSha256 } from './sha256';

export interface HashProgress {
  bytesHashed: number;
  totalBytes: number;
  percent: number;
}

export interface HashFileOptions {
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: HashProgress) => void;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashFileSha256(file: Blob, options: HashFileOptions = {}): Promise<string> {
  const chunkSize = options.chunkSize ?? 1024 * 1024;
  const hasher = new IncrementalSha256();
  let offset = 0;

  while (offset < file.size) {
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const end = Math.min(offset + chunkSize, file.size);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    hasher.update(chunk);
    offset = end;
    options.onProgress?.({
      bytesHashed: offset,
      totalBytes: file.size,
      percent: file.size ? Math.round((offset / file.size) * 100) : 100,
    });
  }

  return bytesToHex(hasher.digest());
}

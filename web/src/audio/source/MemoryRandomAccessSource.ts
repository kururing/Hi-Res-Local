import { MAX_OPEN_CACHE_BYTES, type RandomAccessSource } from './types';

/** In-memory source for tests and DST bounded fallback. */
export class MemoryRandomAccessSource implements RandomAccessSource {
  private aborted = false;

  constructor(private readonly bytes: Uint8Array) {}

  size(): number {
    return this.bytes.length;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.assertOpen();
    if (offset >= this.bytes.length || length <= 0) return new Uint8Array();
    const end = Math.min(this.bytes.length, offset + length);
    return this.bytes.slice(offset, end);
  }

  tryReadCached(offset: number, length: number): Uint8Array | null {
    if (this.aborted) return null;
    if (offset >= this.bytes.length) return new Uint8Array();
    if (length <= 0) return new Uint8Array();
    const end = Math.min(this.bytes.length, offset + length);
    return this.bytes.subarray(offset, end);
  }

  abort(): void {
    this.aborted = true;
  }

  invalidatePlaybackWindows(): void {}

  compactPlayback(): void {}

  cachedByteCount(): number {
    return Math.min(this.bytes.length, MAX_OPEN_CACHE_BYTES);
  }

  private assertOpen(): void {
    if (this.aborted) {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    }
  }
}

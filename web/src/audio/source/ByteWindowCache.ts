import { RANGE_HEADER_BYTES } from './types';

interface Window {
  start: number;
  bytes: Uint8Array;
  lastHit: number;
}

/** Sliding compressed windows. Never grows to the object size. Header at offset 0 is pinned. */
export class ByteWindowCache {
  private windows: Window[] = [];
  private clock = 0;

  constructor(public maxBytes: number) {}

  byteCount(): number {
    return this.windows.reduce((sum, window) => sum + window.bytes.length, 0);
  }

  put(start: number, bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    const end = start + bytes.length;
    this.windows = this.windows.filter(window => window.start + window.bytes.length <= start || window.start >= end);
    this.windows.push({ start, bytes: bytes.slice(), lastHit: ++this.clock });
    this.evict();
  }

  slice(offset: number, length: number): Uint8Array | null {
    if (length <= 0) return new Uint8Array();
    for (const window of this.windows) {
      if (offset < window.start || offset >= window.start + window.bytes.length) continue;
      window.lastHit = ++this.clock;
      const inner = offset - window.start;
      const count = Math.min(length, window.bytes.length - inner);
      return window.bytes.subarray(inner, inner + count);
    }
    return null;
  }

  clearExceptHeader(headerBytes = RANGE_HEADER_BYTES): void {
    const header = this.slice(0, headerBytes);
    this.windows = [];
    if (header && header.length > 0) this.put(0, header);
  }

  evict(): void {
    while (this.byteCount() > this.maxBytes && this.windows.length > 1) {
      let victim = -1;
      let oldest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < this.windows.length; index += 1) {
        const window = this.windows[index]!;
        if (window.start === 0) continue;
        if (window.lastHit < oldest) {
          oldest = window.lastHit;
          victim = index;
        }
      }
      if (victim < 0) break;
      this.windows.splice(victim, 1);
    }
  }
}

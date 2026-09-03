import { playbackError } from '../browserErrors';
import { ByteWindowCache } from './ByteWindowCache';
import {
  MAX_OPEN_CACHE_BYTES,
  MAX_PLAYBACK_CACHE_BYTES,
  MAX_PROGRESSIVE_FALLBACK_BYTES,
  RANGE_HEADER_BYTES,
  RANGE_WINDOW_BYTES,
  RANGE_WINDOW_MAX_BYTES,
  parseContentRangeTotal,
  type RandomAccessSource,
} from './types';

export interface HttpRangeSourceOptions {
  urlProvider: () => Promise<string>;
  signal?: AbortSignal;
  windowBytes?: number;
  headerBytes?: number;
  maxProgressiveBytes?: number;
  fetchImpl?: typeof fetch;
}

interface InflightRange {
  start: number;
  end: number;
  generation: number;
  promise: Promise<Uint8Array>;
}

export class HttpRangeSource implements RandomAccessSource {
  private readonly urlProvider: () => Promise<string>;
  private readonly trackSignal?: AbortSignal;
  private readonly fetchImpl: typeof fetch;
  private readonly windowBytes: number;
  private readonly headerBytes: number;
  private readonly maxProgressiveBytes: number;
  private readonly cache: ByteWindowCache;

  private url = '';
  private total = 0;
  private probed = false;
  private generation = 1;
  private fetchAbort = new AbortController();
  private inflight: InflightRange[] = [];
  private closed = false;
  private refreshAttempted = false;

  constructor(options: HttpRangeSourceOptions) {
    this.urlProvider = options.urlProvider;
    this.trackSignal = options.signal;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.windowBytes = clampWindow(options.windowBytes ?? RANGE_WINDOW_BYTES);
    this.headerBytes = clampWindow(options.headerBytes ?? RANGE_HEADER_BYTES);
    this.maxProgressiveBytes = options.maxProgressiveBytes ?? MAX_PROGRESSIVE_FALLBACK_BYTES;
    this.cache = new ByteWindowCache(MAX_OPEN_CACHE_BYTES);
    this.trackSignal?.addEventListener('abort', () => this.abort(), { once: true });
  }

  size(): number {
    return this.total;
  }

  cachedByteCount(): number {
    return this.cache.byteCount();
  }

  tryReadCached(offset: number, length: number): Uint8Array | null {
    if (this.closed) return null;
    if (this.probed && offset >= this.total) return new Uint8Array();
    return this.cache.slice(offset, length);
  }

  abort(): void {
    this.closed = true;
    this.generation += 1;
    this.fetchAbort.abort();
    this.inflight = [];
  }

  invalidatePlaybackWindows(): void {
    if (this.closed) return;
    this.generation += 1;
    this.fetchAbort.abort();
    this.fetchAbort = new AbortController();
    this.inflight = [];
    this.cache.maxBytes = MAX_PLAYBACK_CACHE_BYTES;
    this.cache.clearExceptHeader(this.headerBytes);
  }

  compactPlayback(): void {
    this.cache.maxBytes = MAX_PLAYBACK_CACHE_BYTES;
    this.cache.evict();
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.assertOpen();
    await this.ensureProbed();
    if (length <= 0 || offset >= this.total) return new Uint8Array();
    const want = Math.min(length, this.total - offset);
    const hit = this.cache.slice(offset, want);
    if (hit && hit.length === want) return hit.slice();
    const fetchEnd = Math.min(this.total, offset + Math.max(want, this.windowBytes)) - 1;
    await this.fetchIntoCache(offset, fetchEnd);
    const ready = this.cache.slice(offset, want);
    if (!ready) throw playbackError('NETWORK');
    return ready.slice();
  }

  private async ensureProbed(): Promise<void> {
    if (this.probed) return;
    this.url = await this.urlProvider();
    const headEnd = Math.min(255, Math.max(0, this.headerBytes - 1));
    const body = await this.rangeRequest(0, headEnd, false);
    if (!this.probed) {
      this.total = body.length;
      this.probed = true;
    }
    this.cache.put(0, body);
    if (this.total > this.headerBytes) {
      await this.fetchIntoCache(0, this.headerBytes - 1);
    }
  }

  private async fetchIntoCache(start: number, end: number): Promise<void> {
    this.assertOpen();
    const clampedEnd = Math.min(end, Math.max(0, this.total - 1));
    if (start > clampedEnd) return;
    const covering = this.inflight.find(
      job => job.generation === this.generation && job.start <= start && job.end >= clampedEnd,
    );
    if (covering) {
      await covering.promise;
      this.assertGeneration(covering.generation);
      return;
    }
    const overlapping = this.inflight.filter(
      job => job.generation === this.generation && job.start <= clampedEnd && job.end >= start,
    );
    if (overlapping.length > 0) {
      await Promise.all(overlapping.map(job => job.promise.catch(() => undefined)));
      this.assertOpen();
      const hit = this.cache.slice(start, clampedEnd - start + 1);
      if (hit && hit.length === clampedEnd - start + 1) return;
    }
    const gen = this.generation;
    const promise = this.rangeRequest(start, clampedEnd, true);
    const job = { start, end: clampedEnd, generation: gen, promise };
    this.inflight.push(job);
    try {
      const body = await promise;
      this.assertGeneration(gen);
      this.cache.put(start, body);
    } finally {
      this.inflight = this.inflight.filter(item => item !== job);
    }
  }

  private async rangeRequest(start: number, end: number, expectSize: boolean, retried = false): Promise<Uint8Array> {
    this.assertOpen();
    const gen = this.generation;
    const url = this.url || (this.url = await this.urlProvider());
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Range: `bytes=${start}-${end}` },
        signal: this.fetchAbort.signal,
      });
    } catch (error) {
      this.throwFetchError(error);
    }
    this.assertGeneration(gen);
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      if (retried || this.refreshAttempted) throw playbackError('SIGNED_URL_EXPIRED');
      this.refreshAttempted = true;
      this.url = await this.urlProvider();
      this.refreshAttempted = false;
      return this.rangeRequest(start, end, expectSize, true);
    }
    if (response.status === 206) {
      const total = parseContentRangeTotal(response.headers.get('content-range'));
      if (total == null) {
        await response.body?.cancel().catch(() => undefined);
        throw playbackError('RANGE_REQUIRED');
      }
      this.total = total;
      this.probed = true;
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.assertGeneration(gen);
      this.refreshAttempted = false;
      return bytes;
    }
    if (response.status === 200) {
      return this.handleWholeBody(response, start, end, expectSize, gen);
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 404 || response.status === 410) throw playbackError('SOURCE_UNAVAILABLE');
    throw playbackError('NETWORK');
  }

  private async handleWholeBody(
    response: Response,
    start: number,
    end: number,
    expectSize: boolean,
    gen: number,
  ): Promise<Uint8Array> {
    const declared = Number(response.headers.get('content-length'));
    const known = Number.isFinite(declared) ? declared : expectSize ? this.total : Number.NaN;
    if (!Number.isFinite(known) || known > this.maxProgressiveBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw playbackError('RANGE_REQUIRED');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.assertGeneration(gen);
    if (bytes.length > this.maxProgressiveBytes) throw playbackError('RANGE_REQUIRED');
    this.total = bytes.length;
    this.probed = true;
    this.cache.put(0, bytes);
    const sliceEnd = Math.min(bytes.length, end + 1);
    if (start >= bytes.length) return new Uint8Array();
    return bytes.slice(start, sliceEnd);
  }

  private assertOpen(): void {
    if (this.closed || this.trackSignal?.aborted || this.fetchAbort.signal.aborted) {
      throw playbackError('REQUEST_ABORTED', true);
    }
  }

  private assertGeneration(generation: number): void {
    this.assertOpen();
    if (generation !== this.generation) throw playbackError('REQUEST_ABORTED', true);
  }

  private throwFetchError(error: unknown): never {
    if (this.closed || this.trackSignal?.aborted || this.fetchAbort.signal.aborted) {
      throw playbackError('REQUEST_ABORTED', true);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw playbackError('REQUEST_ABORTED', true);
    }
    throw playbackError('NETWORK');
  }
}

function clampWindow(value: number): number {
  if (!Number.isFinite(value)) return RANGE_WINDOW_BYTES;
  return Math.min(RANGE_WINDOW_MAX_BYTES, Math.max(64 * 1024, Math.floor(value)));
}

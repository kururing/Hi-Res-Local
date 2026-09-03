import { playbackError } from '../browserErrors';
import { MemoryRandomAccessSource } from './MemoryRandomAccessSource';
import { MAX_BOUNDED_WHOLE_FILE_BYTES, RANGE_WINDOW_MAX_BYTES, type RandomAccessSource } from './types';

/**
 * Last-resort whole-file buffer for codecs that cannot random-access (some DST paths).
 * Never used for FLAC/PCM Range playback.
 */
export async function loadBoundedWholeFile(
  source: RandomAccessSource,
  maxBytes = MAX_BOUNDED_WHOLE_FILE_BYTES,
): Promise<MemoryRandomAccessSource> {
  const size = source.size();
  if (!Number.isFinite(size) || size <= 0) throw playbackError('DECODE');
  if (size > maxBytes) throw playbackError('BOUNDED_FALLBACK');
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const chunk = await source.read(offset, Math.min(RANGE_WINDOW_MAX_BYTES, size - offset));
    if (chunk.length === 0) break;
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== size) throw playbackError('DECODE');
  return new MemoryRandomAccessSource(bytes);
}

export async function readBoundedAudioResponse(
  response: Response,
  signal?: AbortSignal,
  maxBytes = MAX_BOUNDED_WHOLE_FILE_BYTES,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw playbackError('BOUNDED_FALLBACK');
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw playbackError('BOUNDED_FALLBACK');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw playbackError('REQUEST_ABORTED', true);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw playbackError('BOUNDED_FALLBACK');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

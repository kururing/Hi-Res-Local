import { describe, expect, it } from 'vitest';
import { readBoundedAudioResponse } from '../audio/source/boundedWholeFile';
import { MAX_BOUNDED_WHOLE_FILE_BYTES } from '../audio/source/types';

describe('bounded whole-file fallback', () => {
  it('reads a response within the configured byte limit', async () => {
    const bytes = await readBoundedAudioResponse(new Response(new Uint8Array([1, 2, 3])), undefined, 3);
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('rejects a response before an unbounded source is buffered', async () => {
    await expect(readBoundedAudioResponse(
      new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-length': '4' } }),
      undefined,
      3,
    )).rejects.toMatchObject({ code: 'BOUNDED_FALLBACK' });
  });

  it('keeps the 256 MiB cap on the DST fallback only', () => {
    expect(MAX_BOUNDED_WHOLE_FILE_BYTES).toBe(256 * 1024 * 1024);
  });
});

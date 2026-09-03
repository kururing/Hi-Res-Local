import { describe, expect, it } from 'vitest';
import { CORE_LOW_WATER_SECONDS, CORE_MAX_BUFFER_SECONDS, corePcmBufferIsFull, corePcmShouldDecode } from '../audio/core/CorePlaybackSession';

describe('core PCM buffering', () => {
  it('stops decoding once the bounded read-ahead window is full', () => {
    expect(corePcmBufferIsFull(CORE_MAX_BUFFER_SECONDS - 0.01, 0)).toBe(false);
    expect(corePcmBufferIsFull(CORE_MAX_BUFFER_SECONDS, 0)).toBe(true);
    expect(corePcmBufferIsFull(42, 40)).toBe(false);
  });

  it('refills only after the buffer falls to the low-water mark', () => {
    expect(CORE_LOW_WATER_SECONDS).toBe(3);
    expect(corePcmShouldDecode(8, 0, true)).toEqual({ decode: false, filling: false });
    expect(corePcmShouldDecode(7, 0, false)).toEqual({ decode: false, filling: false });
    expect(corePcmShouldDecode(3, 0, false)).toEqual({ decode: true, filling: true });
    expect(corePcmShouldDecode(4, 0, true)).toEqual({ decode: true, filling: true });
  });
});

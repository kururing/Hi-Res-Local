import { describe, expect, it } from 'vitest';
import { CORE_CHUNK_SECONDS, slicePcmWindow } from '../audio/core/CoreDecoder';
import { transferablePcmFrames } from '../audio/PcmOutputGraph';

function fillInterleaved(seconds: number, sampleRate: number, channels: number): Float32Array {
  const pcm = new Float32Array(seconds * sampleRate * channels);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = i;
  return pcm;
}

describe('PCM window transfer', () => {
  it('copies each decode window so a worklet transfer cannot detach the file', () => {
    const sampleRate = 8;
    const channels = 2;
    const pcm = fillInterleaved(6, sampleRate, channels);

    const first = slicePcmWindow(pcm, 0, CORE_CHUNK_SECONDS, channels, sampleRate);
    expect(first.frames.length).toBe(sampleRate * channels * CORE_CHUNK_SECONDS);
    expect(first.frames.buffer).not.toBe(pcm.buffer);

    structuredClone(first.frames, { transfer: [first.frames.buffer] });
    expect(pcm[0]).toBe(0);

    const second = slicePcmWindow(pcm, CORE_CHUNK_SECONDS, CORE_CHUNK_SECONDS, channels, sampleRate);
    expect(second.frames.length).toBe(sampleRate * channels * CORE_CHUNK_SECONDS);
    expect(second.frames[0]).toBe(sampleRate * channels * CORE_CHUNK_SECONDS);
  });

  it('reproduces the 2s cutoff when a subarray of the file is transferred', () => {
    const sampleRate = 8;
    const channels = 2;
    const pcm = fillInterleaved(6, sampleRate, channels);
    const windowSamples = sampleRate * channels * CORE_CHUNK_SECONDS;
    const first = pcm.subarray(0, windowSamples);

    structuredClone(first, { transfer: [first.buffer] });

    expect(pcm.length).toBe(0);
    const second = slicePcmWindow(pcm, CORE_CHUNK_SECONDS, CORE_CHUNK_SECONDS, channels, sampleRate);
    expect(second.frames.length).toBe(0);
  });

  it('copies views before they are posted to the worklet', () => {
    const pcm = fillInterleaved(4, 8, 2);
    const view = pcm.subarray(0, 16);
    const owned = transferablePcmFrames(view);
    expect(owned.buffer).not.toBe(pcm.buffer);

    structuredClone(owned, { transfer: [owned.buffer] });
    expect(pcm[0]).toBe(0);
    expect(view[0]).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../services/storage';

const values = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

describe('saved audio state', () => {
  beforeEach(() => values.clear());

  it('uses the safe initial volume when no state was saved', () => {
    expect(Storage.getAudioState()).toEqual({ volume: 0.85, isMuted: false });
  });

  it('restores the last volume and mute state', () => {
    Storage.saveAudioState(0.37, true);
    expect(Storage.getAudioState()).toEqual({ volume: 0.37, isMuted: true });
  });

  it('sanitizes the local playback fallback', () => {
    Storage.saveLastPlayback('track-1', Number.NaN);
    expect(Storage.getLastPlayback()).toEqual({ trackId: 'track-1', position: 0 });

    Storage.saveLastPlayback('track-1', 42.75);
    expect(Storage.getLastPlayback()).toEqual({ trackId: 'track-1', position: 42.75 });
  });
});

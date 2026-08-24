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

describe('saved lyrics mode', () => {
  beforeEach(() => values.clear());

  it('uses both as the default mode', () => {
    expect(Storage.getLyricsMode()).toBe('both');
  });

  it('restores the last selected mode', () => {
    Storage.saveLyricsMode('romanized');
    expect(Storage.getLyricsMode()).toBe('romanized');
  });

  it('ignores an invalid stored value', () => {
    localStorage.setItem('nghenhac_lyrics_mode_v2', 'invalid');
    expect(Storage.getLyricsMode()).toBe('both');
  });
});

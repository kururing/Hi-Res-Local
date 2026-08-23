import { describe, it, expect } from 'vitest';
import { Track } from '../types/library';

describe('Player Queue Logic', () => {
  const mockQueue: Track[] = [
    { id: '1', title: 'Track 1', artist: 'Artist 1', album: 'Album 1', duration: 180, path: 'p1', date_added: '' },
    { id: '2', title: 'Track 2', artist: 'Artist 2', album: 'Album 2', duration: 200, path: 'p2', date_added: '' },
    { id: '3', title: 'Track 3', artist: 'Artist 3', album: 'Album 3', duration: 220, path: 'p3', date_added: '' },
  ];

  function getNextIndex(currentIdx: number, queueLen: number, loopMode: 'off' | 'track' | 'playlist', isAutoEnd: boolean): number {
    if (queueLen === 0) return -1;
    if (isAutoEnd && loopMode === 'track') return currentIdx;
    if (currentIdx + 1 < queueLen) return currentIdx + 1;
    if (loopMode === 'playlist') return 0;
    return -1;
  }

  it('moves sequentially through queue', () => {
    expect(getNextIndex(0, mockQueue.length, 'off', false)).toBe(1);
    expect(getNextIndex(1, mockQueue.length, 'off', false)).toBe(2);
    expect(getNextIndex(2, mockQueue.length, 'off', false)).toBe(-1);
  });

  it('loops playlist when loopMode is playlist', () => {
    expect(getNextIndex(2, mockQueue.length, 'playlist', true)).toBe(0);
  });

  it('repeats single track on auto end when loopMode is track', () => {
    expect(getNextIndex(1, mockQueue.length, 'track', true)).toBe(1);
  });
});

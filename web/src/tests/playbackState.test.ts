import { describe, expect, it } from 'vitest';
import {
  clampPlaybackPosition,
  normalizePlaybackProgress,
  restoreLastPlayback,
} from '../services/playbackState';
import { Track } from '../types/library';

const makeTrack = (id: string, duration: number): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  duration,
  path: `D:/Music/${id}.flac`,
  date_added: '2026-08-24T00:00:00.000Z',
});

describe('playback state restoration', () => {
  it('restores the last track, queue index and saved position', () => {
    const tracks = [makeTrack('first', 180), makeTrack('last', 240)];

    expect(restoreLastPlayback(tracks, { trackId: 'last', position: 73.5 })).toEqual({
      track: tracks[1],
      position: 73.5,
      queueIndex: 1,
    });
  });

  it('clamps a saved or requested position to the track duration', () => {
    expect(clampPlaybackPosition(999, 240)).toBe(240);
    expect(clampPlaybackPosition(-5, 240)).toBe(0);
  });

  it('ignores a track that is no longer in the library', () => {
    expect(restoreLastPlayback([makeTrack('first', 180)], {
      trackId: 'missing',
      position: 20,
    })).toBeNull();
  });

  it('uses the decoder duration and never displays a position beyond it', () => {
    expect(normalizePlaybackProgress(183, 182.4, 180)).toEqual({
      position: 182.4,
      duration: 182.4,
    });
  });

  it('keeps the known duration when an event does not report one', () => {
    expect(normalizePlaybackProgress(73, undefined, 180)).toEqual({
      position: 73,
      duration: 180,
    });
  });
});

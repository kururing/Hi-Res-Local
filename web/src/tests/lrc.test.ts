import { describe, it, expect } from 'vitest';
import { parseLrc, findActiveLyricIndex } from '../services/lrc';

describe('LRC Parser & Sync Engine', () => {
  const sampleLrc = `[ti:Test Title]
[ar:Test Artist]
[al:Test Album]
[offset:500]
[00:01.00]First line
[00:05.50]Second line
[00:10.25]Third line
[00:15.00][00:20.00]Multi-timestamp line`;

  it('correctly parses metadata tags and timestamps', () => {
    const data = parseLrc(sampleLrc);
    expect(data.title).toBe('Test Title');
    expect(data.artist).toBe('Test Artist');
    expect(data.album).toBe('Test Album');
    expect(data.offset).toBe(500);
    expect(data.is_synced).toBe(true);
    expect(data.lines.length).toBe(5);

    // Offset +500ms should be added to timestamps
    expect(data.lines[0].timestamp).toBeCloseTo(1.5, 2);
    expect(data.lines[0].text).toBe('First line');
    expect(data.lines[1].timestamp).toBeCloseTo(6.0, 2);
    expect(data.lines[1].text).toBe('Second line');
  });

  it('correctly finds active lyric line index based on current playback timestamp', () => {
    const data = parseLrc(sampleLrc);

    expect(findActiveLyricIndex(data.lines, 0)).toBe(-1);
    expect(findActiveLyricIndex(data.lines, 1.5)).toBe(0);
    expect(findActiveLyricIndex(data.lines, 3.0)).toBe(0);
    expect(findActiveLyricIndex(data.lines, 6.0)).toBe(1);
    expect(findActiveLyricIndex(data.lines, 10.75)).toBe(2);
    expect(findActiveLyricIndex(data.lines, 100)).toBe(4);
  });
});

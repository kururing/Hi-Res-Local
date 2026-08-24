import { describe, it, expect } from 'vitest';
import {
  parseLrc,
  findActiveLyricIndex,
  normalizeLyricsData,
  computeEffectiveLyricsMode,
  hasCompleteRomanizedLyrics,
} from '../services/lrc';

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

  it('applies a global offset even when declared after lyric lines', () => {
    const data = parseLrc('[00:01.00]First\n[00:02:50]Second\n[offset:+500]');
    expect(data.lines[0].timestamp).toBe(1.5);
    expect(data.lines[1].timestamp).toBe(3.0);
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

  it('matches romanized lyrics timestamps accurately', () => {
    const orig = `[00:02.00]夜に駆ける\n[00:08.00]沈むように溶けてゆくように`;
    const rom = `[00:02.10]Yoru ni kakeru\n[00:07.90]Shizumu you ni tokete yuku you ni`;

    const data = parseLrc(orig, rom);
    expect(data.is_synced).toBe(true);
    expect(data.lines.length).toBe(2);
    expect(data.lines[0].text).toBe('夜に駆ける');
    expect(data.lines[0].romanized).toBe('Yoru ni kakeru');
    expect(data.lines[1].text).toBe('沈むように溶けてゆくように');
    expect(data.lines[1].romanized).toBe('Shizumu you ni tokete yuku you ni');
    expect(data.romanized).toBeDefined();
    expect(data.romanized?.lines.length).toBe(2);
  });

  it('correctly normalizes backend IPC LyricsData responses', () => {
    const rawBackend = {
      is_synced: true,
      lines: [
        { timestamp_ms: 2500, text: 'Original line', romanized: 'Romanized line' },
        { timestamp_ms: 8000, text: 'Second line', romanized: 'Second rom' },
      ],
      plain_text: 'Original line\nSecond line',
      source: 'LrcFile',
      romanized: {
        is_synced: true,
        lines: [
          { timestamp_ms: 2500, text: 'Romanized line' },
          { timestamp_ms: 8000, text: 'Second rom' },
        ],
        plain_text: 'Romanized line\nSecond rom',
        source: 'LrcFile',
      },
    };

    const normalized = normalizeLyricsData(rawBackend);
    expect(normalized).not.toBeNull();
    expect(normalized?.is_synced).toBe(true);
    expect(normalized?.lines[0].timestamp).toBe(2.5);
    expect(normalized?.lines[0].text).toBe('Original line');
    expect(normalized?.lines[0].romanized).toBe('Romanized line');
    expect(normalized?.lines[1].timestamp).toBe(8.0);
    expect(normalized?.romanized?.lines[0].timestamp).toBe(2.5);
    expect(normalized?.romanized?.lines[0].text).toBe('Romanized line');
  });

  it('handles absent romanized lyrics gracefully', () => {
    const rawBackend = {
      is_synced: true,
      lines: [{ timestamp_ms: 1000, text: 'Solo line' }],
      plain_text: 'Solo line',
      source: 'Embedded',
    };

    const normalized = normalizeLyricsData(rawBackend);
    expect(normalized?.is_synced).toBe(true);
    expect(normalized?.lines[0].romanized).toBeUndefined();
    expect(normalized?.romanized).toBeUndefined();
  });

  it('correctly handles romanized-only payload without duplicating text', () => {
    const rawBackend = {
      is_synced: false,
      lines: [],
      plain_text: '',
      source: 'None',
      romanized: {
        is_synced: true,
        lines: [{ timestamp_ms: 1500, text: 'Romaji Only Line' }],
        plain_text: 'Romaji Only Line',
        source: 'LrcFile',
      },
    };

    const normalized = normalizeLyricsData(rawBackend);
    expect(normalized).not.toBeNull();
    expect(normalized?.lines.length).toBe(0);
    expect(normalized?.plain_text).toBe('');
    expect(normalized?.romanized?.is_synced).toBe(true);
    expect(normalized?.romanized?.lines[0].text).toBe('Romaji Only Line');
    expect(normalized?.romanized?.lines[0].timestamp).toBe(1.5);
  });

  it('coerces lyrics mode safely using computeEffectiveLyricsMode', () => {
    // 1. Null data
    expect(computeEffectiveLyricsMode(null, 'both')).toBe('original');

    // 2. Original-only data (must always fallback to original even if previously in romanized/both)
    const origOnly = {
      is_synced: true,
      lines: [{ timestamp: 1.0, text: 'Original line' }],
      plain_text: 'Original line',
    };
    expect(computeEffectiveLyricsMode(origOnly, 'romanized')).toBe('original');
    expect(computeEffectiveLyricsMode(origOnly, 'both')).toBe('original');
    expect(computeEffectiveLyricsMode(origOnly, 'original')).toBe('original');

    // 3. Romanized-only data (must choose romanized even if previously in original/both)
    const romOnly = {
      is_synced: false,
      lines: [],
      plain_text: '',
      romanized: {
        is_synced: true,
        lines: [{ timestamp: 1.0, text: 'Rom line' }],
        plain_text: 'Rom line',
      },
    };
    expect(computeEffectiveLyricsMode(romOnly, 'original')).toBe('romanized');
    expect(computeEffectiveLyricsMode(romOnly, 'both')).toBe('romanized');
    expect(computeEffectiveLyricsMode(romOnly, 'romanized')).toBe('romanized');

    // 4. Both original and romanized exist
    const bothData = {
      is_synced: true,
      lines: [{ timestamp: 1.0, text: 'Orig', romanized: 'Rom' }],
      plain_text: 'Orig',
      romanized: {
        is_synced: true,
        lines: [{ timestamp: 1.0, text: 'Rom' }],
        plain_text: 'Rom',
      },
    };
    expect(computeEffectiveLyricsMode(bothData, undefined)).toBe('both');
    expect(computeEffectiveLyricsMode(bothData, 'both')).toBe('both');
    expect(computeEffectiveLyricsMode(bothData, 'original')).toBe('original');
    expect(computeEffectiveLyricsMode(bothData, 'romanized')).toBe('romanized');
  });

  it('rejects a companion that still mixes Japanese original lines into romaji', () => {
    const partial = parseLrc('[00:01.00]言葉にすれば\n[00:02.00]Demo sonnanja dame');
    const lyrics = parseLrc('[00:01.00]言葉にすれば\n[00:02.00]でもそんなんじゃだめ');
    lyrics.romanized = partial;
    expect(hasCompleteRomanizedLyrics(lyrics)).toBe(false);
    expect(computeEffectiveLyricsMode(lyrics, 'romanized')).toBe('original');
  });

  it('rejects incomplete romanization from non-CJK scripts too', () => {
    const lyrics = parseLrc('[00:01.00]Привет мир');
    lyrics.romanized = parseLrc('[00:01.00]Привет mir');
    expect(hasCompleteRomanizedLyrics(lyrics)).toBe(false);
  });
});

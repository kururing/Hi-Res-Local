import { describe, expect, it } from 'vitest';
import { romanizedLyricsStorageKey } from '../services/romanizedLyrics';
import { LyricData } from '../types/lyrics';

const lyrics = (text: string): LyricData => ({
  is_synced: true,
  lines: [{ timestamp: 1, text }],
  plain_text: text,
  source: 'lrclib',
});

describe('romanized lyrics cache', () => {
  it('uses the original lyric content in its cache identity', () => {
    const japaneseKey = romanizedLyricsStorageKey('track-1', lyrics('まだまだ'));
    const koreanKey = romanizedLyricsStorageKey('track-1', lyrics('달려 달려'));

    expect(japaneseKey).not.toBe(koreanKey);
    expect(koreanKey).toContain('nghenhacpromax:romanized:v2:track-1:');
  });
});

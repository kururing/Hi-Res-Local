import { describe, expect, it } from 'vitest';
import type { LyricData } from '../types/lyrics';
import {
  cloudNeedsLocalLanguageLookup,
  expectedLyricsScript,
  pickPreferredLyrics,
} from '../services/lyricsRank';

function lyrics(overrides: Partial<LyricData> & Pick<LyricData, 'lines' | 'is_synced'>): LyricData {
  return {
    source: 'local',
    ...overrides,
  };
}

describe('frontend lyrics ranking', () => {
  it('infers the track language from script, genre, or an explicit tag', () => {
    expect(expectedLyricsScript({
      title: '고민보다 Go',
      artist: 'BTS',
      album: "LOVE YOURSELF 承 'Her'",
    })).toBe('hangul');
    expect(expectedLyricsScript({
      title: 'Boy In Luv',
      artist: 'BTS',
      album: 'Proof',
      genre: 'K-Pop',
    })).toBe('hangul');
    expect(expectedLyricsScript({
      title: 'Lanterns',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
      language: 'vi',
    })).toBe('vietnamese');
  });

  it('picks synchronized original-language lyrics over a synced translation', () => {
    const stored = lyrics({
      is_synced: true,
      lines: [{ timestamp: 1, text: '하루아침에 전부 탕진 달려 달려' }],
      source: 'local',
    });
    const remote = lyrics({
      is_synced: true,
      lines: [{ timestamp: 1, text: '全て無くすまで まだまだ 走り稼ぐだけ' }],
      source: 'lrclib',
    });

    expect(pickPreferredLyrics([
      { lyrics: remote, source: 'remote' },
      { lyrics: stored, source: 'stored' },
    ], {
      title: '고민보다 Go',
      artist: 'BTS',
      album: "LOVE YOURSELF 承 'Her'",
    })).toEqual(stored);
  });

  it('picks synchronized other-language lyrics over plain original-language lyrics', () => {
    const stored = lyrics({
      is_synced: false,
      lines: [],
      plain_text: '하루아침에 전부 탕진 달려 달려',
      source: 'local',
    });
    const remote = lyrics({
      is_synced: true,
      lines: [{ timestamp: 1, text: '全て無くすまで まだまだ 走り稼ぐだけ' }],
      source: 'lrclib',
    });

    expect(pickPreferredLyrics([
      { lyrics: remote, source: 'remote' },
      { lyrics: stored, source: 'stored' },
    ], {
      title: '고민보다 Go',
      artist: 'BTS',
      album: "LOVE YOURSELF 承 'Her'",
    })).toEqual(remote);
  });

  it('asks desktop LRCLIB when a synced cloud result is the wrong language', () => {
    const cloud = lyrics({
      is_synced: true,
      lines: [{ timestamp: 1, text: 'I keep running through the night again' }],
      source: 'lrclib',
    });

    expect(cloudNeedsLocalLanguageLookup(cloud, {
      title: '고민보다 Go',
      artist: 'BTS',
      album: "LOVE YOURSELF 承 'Her'",
    })).toBe(true);
    expect(cloudNeedsLocalLanguageLookup(cloud, {
      title: 'Lanterns',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
    })).toBe(false);
  });
});

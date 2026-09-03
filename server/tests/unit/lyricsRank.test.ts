import { describe, expect, it } from 'vitest';
import {
  expectedLyricsScript,
  languageMatchRank,
  selectBestLyricsCandidate,
  type LyricsRankCandidate,
  type LyricsRankQuery,
} from '../../src/lyrics/rank.js';

function candidate(overrides: Partial<LyricsRankCandidate> & Pick<LyricsRankCandidate, 'id'>): LyricsRankCandidate {
  return {
    trackName: '고민보다 Go',
    artistName: 'BTS',
    albumName: "LOVE YOURSELF 承 'Her'",
    duration: 235,
    instrumental: false,
    plainLyrics: '하루아침에 전부 탕진 달려 달려',
    syncedLyrics: '[00:01.00]하루아침에 전부 탕진 달려 달려',
    ...overrides,
  };
}

const koreanQuery: LyricsRankQuery = {
  title: '고민보다 Go',
  artist: 'BTS',
  album: "LOVE YOURSELF 承 'Her'",
  durationSeconds: 235,
};

describe('lyrics ranking', () => {
  it('infers hangul from a native title and k-pop genre from an english title', () => {
    expect(expectedLyricsScript('고민보다 Go', 'BTS', "LOVE YOURSELF 承 'Her'")).toBe('hangul');
    expect(expectedLyricsScript('Boy In Luv', 'BTS', 'Proof', 'K-Pop')).toBe('hangul');
    expect(expectedLyricsScript('Nắng Ấm Xa Dần', 'Sơn Tùng M-TP', 'Skylight')).toBe('vietnamese');
    expect(expectedLyricsScript('Lanterns', 'Aurora Circuit', 'Glass Harbor', null, 'vi')).toBe('vietnamese');
  });

  it('prefers synchronized lyrics in the track language', () => {
    const selected = selectBestLyricsCandidate([
      candidate({
        id: 1,
        syncedLyrics: null,
        plainLyrics: '하루아침에 전부 탕진 달려 달려',
      }),
      candidate({
        id: 2,
        plainLyrics: '全て無くすまで まだまだ 走り稼ぐだけ',
        syncedLyrics: '[00:01.00]全て無くすまで まだまだ 走り稼ぐだけ',
      }),
      candidate({
        id: 3,
        plainLyrics: '하루아침에 전부 탕진 달려 달려',
        syncedLyrics: '[00:01.00]하루아침에 전부 탕진 달려 달려',
      }),
    ], koreanQuery);

    expect(selected?.id).toBe(3);
  });

  it('ranks synchronized other-language lyrics above plain original-language lyrics', () => {
    const selected = selectBestLyricsCandidate([
      candidate({
        id: 10,
        syncedLyrics: null,
        plainLyrics: '하루아침에 전부 탕진 달려 달려',
      }),
      candidate({
        id: 11,
        plainLyrics: '全て無くすまで まだまだ 走り稼ぐだけ',
        syncedLyrics: '[00:01.00]全て無くすまで まだまだ 走り稼ぐだけ',
      }),
    ], koreanQuery);

    expect(selected?.id).toBe(11);
  });

  it('ranks plain original-language lyrics above plain translations', () => {
    const selected = selectBestLyricsCandidate([
      candidate({
        id: 20,
        syncedLyrics: null,
        plainLyrics: '全て無くすまで まだまだ 走り稼ぐだけ',
      }),
      candidate({
        id: 21,
        syncedLyrics: null,
        plainLyrics: '하루아침에 전부 탕진 달려 달려',
      }),
    ], koreanQuery);

    expect(selected?.id).toBe(21);
  });

  it('rejects unrelated search hits even when they are synchronized', () => {
    expect(selectBestLyricsCandidate([
      candidate({
        id: 30,
        trackName: 'Go Go',
        artistName: 'Different Artist',
        albumName: 'Different Album',
        plainLyrics: 'Some other lyrics about something else',
        syncedLyrics: '[00:01.00]Some other lyrics about something else',
      }),
    ], {
      title: 'Go Go',
      artist: 'BTS',
      album: "Love Yourself 結 'Answer'",
      durationSeconds: 235,
    })).toBeNull();
  });

  it('treats instrumental as a successful match instead of not-found', () => {
    const selected = selectBestLyricsCandidate([
      {
        id: 40,
        trackName: 'Interlude',
        artistName: 'Aurora Circuit',
        albumName: 'Glass Harbor',
        duration: 92,
        instrumental: true,
        plainLyrics: null,
        syncedLyrics: null,
      },
    ], {
      title: 'Interlude',
      artist: 'Aurora Circuit',
      album: 'Glass Harbor',
      durationSeconds: 92,
    });

    expect(selected?.id).toBe(40);
    expect(selected?.instrumental).toBe(true);
  });

  it('uses an explicit language tag and genre when the title is latin', () => {
    const chinese = candidate({
      id: 51,
      trackName: 'Boy In Luv',
      albumName: 'Proof',
      duration: 231,
      plainLyrics: '放不下 誰在尷尬 而我自問自答 練習牽掛',
      syncedLyrics: '[00:01.00]放不下 誰在尷尬 而我自問自答 練習牽掛',
    });
    const korean = candidate({
      id: 52,
      trackName: 'Boy In Luv',
      albumName: 'Skool Luv Affair Special Addition',
      duration: 231,
      plainLyrics: '되고파 너의 오빠 너의 사랑이 난 너무 고파',
      syncedLyrics: '[00:01.00]되고파 너의 오빠 너의 사랑이 난 너무 고파',
    });

    expect(selectBestLyricsCandidate([chinese, korean], {
      title: 'Boy In Luv',
      artist: 'BTS',
      album: 'Proof',
      durationSeconds: 231,
      genre: 'K-Pop',
    })?.id).toBe(52);

    expect(languageMatchRank(
      '되고파 너의 오빠 너의 사랑이 난 너무 고파',
      { title: 'Boy In Luv', artist: 'BTS', album: 'Proof', language: 'ko' },
    )).toBe(2);
    expect(languageMatchRank(
      'I keep running through the night again',
      { title: '고민보다 Go', artist: 'BTS', album: "LOVE YOURSELF 承 'Her'" },
    )).toBe(0);
  });
});

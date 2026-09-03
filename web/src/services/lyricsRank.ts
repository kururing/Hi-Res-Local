import type { LyricData } from '../types/lyrics';

export type LyricsScript = 'hangul' | 'kana' | 'han' | 'cyrillic' | 'arabic' | 'vietnamese';
export type LyricsPickSource = 'stored' | 'embedded' | 'remote';
export type LanguageMatchRank = 0 | 1 | 2;

export interface LyricsRankTrack {
  title: string;
  artist: string;
  album: string;
  genre?: string | null;
  language?: string | null;
}

export interface RankedLyricsOption<T extends LyricData> {
  lyrics: T;
  source: LyricsPickSource;
}

const VIETNAMESE_LETTERS = new Set(
  'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ'
  + 'ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
);

export function normalizedMatchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function dominantLyricsScript(value: string): LyricsScript | null {
  const counts: Record<LyricsScript, number> = {
    hangul: 0,
    kana: 0,
    han: 0,
    cyrillic: 0,
    arabic: 0,
    vietnamese: 0,
  };

  for (const character of value) {
    const code = character.codePointAt(0);
    if (code == null) continue;
    if ((code >= 0xAC00 && code <= 0xD7AF) || (code >= 0x1100 && code <= 0x11FF)) {
      counts.hangul += 1;
    } else if ((code >= 0x3040 && code <= 0x30FF) || (code >= 0x31F0 && code <= 0x31FF)) {
      counts.kana += 1;
    } else if ((code >= 0x3400 && code <= 0x4DBF) || (code >= 0x4E00 && code <= 0x9FFF)) {
      counts.han += 1;
    } else if (code >= 0x0400 && code <= 0x052F) {
      counts.cyrillic += 1;
    } else if (code >= 0x0600 && code <= 0x06FF) {
      counts.arabic += 1;
    } else if (VIETNAMESE_LETTERS.has(character)) {
      counts.vietnamese += 1;
    }
  }

  let best: LyricsScript | null = null;
  let bestCount = 0;
  (Object.keys(counts) as LyricsScript[]).forEach((script) => {
    if (counts[script] > bestCount) {
      best = script;
      bestCount = counts[script];
    }
  });
  return bestCount >= 3 ? best : null;
}

export function scriptFromLanguageTag(language: string | null | undefined): LyricsScript | null {
  const normalized = normalizedMatchText(language ?? '');
  if (!normalized) return null;
  if (['ko', 'kor', 'korean'].includes(normalized)) return 'hangul';
  if (['ja', 'jp', 'jpn', 'japanese'].includes(normalized)) return 'kana';
  if (['zh', 'chi', 'zho', 'chinese', 'cmn', 'yue', 'cantonese', 'mandarin'].includes(normalized)) return 'han';
  if (['vi', 'vie', 'vietnamese'].includes(normalized)) return 'vietnamese';
  if (['ru', 'rus', 'russian'].includes(normalized)) return 'cyrillic';
  if (['ar', 'ara', 'arabic'].includes(normalized)) return 'arabic';
  return null;
}

export function expectedLyricsScript(track: LyricsRankTrack): LyricsScript | null {
  const fromTag = scriptFromLanguageTag(track.language);
  if (fromTag) return fromTag;

  const fromMetadata = dominantLyricsScript(`${track.title} ${track.artist} ${track.album}`);
  if (fromMetadata) return fromMetadata;

  const normalizedGenre = normalizedMatchText(track.genre ?? '');
  if (!normalizedGenre) return null;
  if (normalizedGenre.includes('kpop') || normalizedGenre.includes('korean')) return 'hangul';
  if (normalizedGenre.includes('jpop') || normalizedGenre.includes('japanese')) return 'kana';
  if (
    normalizedGenre.includes('cpop')
    || normalizedGenre.includes('chinese')
    || normalizedGenre.includes('mandopop')
    || normalizedGenre.includes('cantopop')
  ) {
    return 'han';
  }
  if (normalizedGenre.includes('vpop') || normalizedGenre.includes('vietnamese')) return 'vietnamese';
  return null;
}

export function lyricsText(lyrics: LyricData): string {
  if (lyrics.lines.length > 0) return lyrics.lines.map((line) => line.text).join('\n');
  return lyrics.plain_text ?? '';
}

export function isTimestampedLyrics(lyrics: LyricData | null | undefined): lyrics is LyricData {
  return Boolean(lyrics?.is_synced && lyrics.lines.length > 0);
}

export function isMostlyLatin(value: string): boolean {
  let letters = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code == null || VIETNAMESE_LETTERS.has(character)) continue;
    if (code <= 0x024F && /\p{L}/u.test(character)) letters += 1;
  }
  return letters >= 12;
}

export function languageMatchRank(lyrics: LyricData, track: LyricsRankTrack): LanguageMatchRank {
  const expected = expectedLyricsScript(track);
  const text = lyricsText(lyrics);
  const actual = dominantLyricsScript(text);
  if (expected && actual) return expected === actual ? 2 : 0;
  if (expected && !actual && isMostlyLatin(text)) return 0;
  return 1;
}

function sourceRank(source: LyricsPickSource, synced: boolean): number {
  if (synced) {
    if (source === 'remote') return 2;
    if (source === 'stored') return 1;
    return 0;
  }
  if (source === 'stored') return 2;
  if (source === 'embedded') return 1;
  return 0;
}

/**
 * Among already-resolved lyrics for the same track, prefer timestamps first,
 * then the track language, then the stored → embedded → remote cascade for
 * plain text (remote still wins a synced tie so a provider timeline can upgrade).
 */
export function pickPreferredLyrics<T extends LyricData>(
  options: Array<RankedLyricsOption<T> | null | undefined>,
  track: LyricsRankTrack,
): T | null {
  const usable = options.filter((option): option is RankedLyricsOption<T> => Boolean(option?.lyrics));
  if (usable.length === 0) return null;

  return [...usable].sort((left, right) => {
    const leftSynced = isTimestampedLyrics(left.lyrics) ? 1 : 0;
    const rightSynced = isTimestampedLyrics(right.lyrics) ? 1 : 0;
    if (leftSynced !== rightSynced) return rightSynced - leftSynced;

    const languageDelta = languageMatchRank(right.lyrics, track) - languageMatchRank(left.lyrics, track);
    if (languageDelta !== 0) return languageDelta;

    return sourceRank(right.source, rightSynced === 1) - sourceRank(left.source, leftSynced === 1);
  })[0]?.lyrics ?? null;
}

export function cloudNeedsLocalLanguageLookup(
  cloud: LyricData | null,
  track: LyricsRankTrack,
): boolean {
  if (!cloud) return true;
  if (cloud.instrumental) return false;
  if (!isTimestampedLyrics(cloud)) return true;
  return languageMatchRank(cloud, track) === 0;
}

export type LyricsScript = 'hangul' | 'kana' | 'han' | 'cyrillic' | 'arabic' | 'vietnamese';

export interface LyricsRankCandidate {
  id?: number;
  trackName?: string | null;
  artistName?: string | null;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  lang?: string | null;
}

export interface LyricsRankQuery {
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  genre?: string | null;
  language?: string | null;
}

export type LanguageMatchRank = 0 | 1 | 2;

const IDENTITY_MIN_SCORE = 70;

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

export function textRelationScore(
  candidate: string,
  expected: string,
  exact: number,
  contains: number,
): number {
  const normalizedCandidate = normalizedMatchText(candidate);
  const normalizedExpected = normalizedMatchText(expected);
  if (!normalizedCandidate || !normalizedExpected) return 0;
  if (normalizedCandidate === normalizedExpected) return exact;
  if (normalizedCandidate.includes(normalizedExpected) || normalizedExpected.includes(normalizedCandidate)) {
    return contains;
  }
  return 0;
}

export function versionMarkers(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const markers: string[] = [];
  for (const word of ['instrumental', 'karaoke', 'acoustic', 'remix', 'live']) {
    if (words.includes(word)) markers.push(word);
  }
  if (words.some((word) => word.startsWith('remaster'))) markers.push('remaster');
  for (const language of ['japanese', 'korean', 'english']) {
    if (words.some((word, index) => (
      word === language
      && (words[index + 1] === 'version' || (words[index + 1]?.startsWith('ver') ?? false))
    ))) {
      markers.push(language);
    }
  }
  return markers;
}

export function dominantLyricsScript(value: string): LyricsScript | null {
  const counts = {
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

export function expectedLyricsScript(
  title: string,
  artist: string,
  album: string,
  genre?: string | null,
  language?: string | null,
): LyricsScript | null {
  const fromTag = scriptFromLanguageTag(language);
  if (fromTag) return fromTag;

  const fromMetadata = dominantLyricsScript(`${title} ${artist} ${album}`);
  if (fromMetadata) return fromMetadata;

  const normalizedGenre = normalizedMatchText(genre ?? '');
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

export function candidateLyricsText(candidate: LyricsRankCandidate): string {
  return nonempty(candidate.syncedLyrics) ?? nonempty(candidate.plainLyrics) ?? '';
}

export function hasSyncedLyrics(candidate: LyricsRankCandidate): boolean {
  return Boolean(nonempty(candidate.syncedLyrics));
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

export function languageMatchRank(
  lyricsText: string,
  query: Pick<LyricsRankQuery, 'title' | 'artist' | 'album' | 'genre' | 'language'>,
  candidateLang?: string | null,
): LanguageMatchRank {
  const expected = expectedLyricsScript(
    query.title,
    query.artist,
    query.album,
    query.genre,
    query.language,
  );
  const actual = scriptFromLanguageTag(candidateLang) ?? dominantLyricsScript(lyricsText);
  if (expected && actual) return expected === actual ? 2 : 0;
  if (expected && !actual && isMostlyLatin(lyricsText)) return 0;
  return 1;
}

export function identityScore(candidate: LyricsRankCandidate, query: LyricsRankQuery): number | null {
  const titleScore = textRelationScore(candidate.trackName ?? '', query.title, 50, 34);
  const artistScore = textRelationScore(candidate.artistName ?? '', query.artist, 45, 24);
  if (titleScore === 0 || artistScore === 0) return null;

  let score = titleScore + artistScore;
  if (query.album.trim() && query.album !== 'Unknown Album') {
    score += textRelationScore(candidate.albumName ?? '', query.album, 42, 24);
  }

  if (typeof candidate.duration === 'number' && Number.isFinite(candidate.duration)) {
    const difference = Math.abs(candidate.duration - query.durationSeconds);
    if (difference <= 1) score += 36;
    else if (difference <= 2) score += 30;
    else if (difference <= 5) score += 14;
    else if (difference <= 10) score += 2;
    else score -= 30;
  }

  const expectedMarkers = versionMarkers(`${query.title} ${query.album}`);
  const candidateMarkers = versionMarkers(`${candidate.trackName ?? ''} ${candidate.albumName ?? ''}`);
  for (const marker of candidateMarkers) {
    if (!expectedMarkers.includes(marker)) score -= 45;
  }
  for (const marker of expectedMarkers) {
    if (!candidateMarkers.includes(marker)) score -= 30;
  }
  if (candidate.instrumental === true && !expectedMarkers.includes('instrumental')) {
    score -= 60;
  }

  const expectedScript = expectedLyricsScript(
    query.title,
    query.artist,
    query.album,
    query.genre,
    query.language,
  );
  const lyricScript = dominantLyricsScript(candidateLyricsText(candidate));
  if (expectedScript && lyricScript) {
    score += expectedScript === lyricScript ? 14 : -35;
  }

  return score;
}

export function isUsableLyricsCandidate(candidate: LyricsRankCandidate): boolean {
  if (candidate.instrumental === true) return true;
  return hasSyncedLyrics(candidate) || Boolean(nonempty(candidate.plainLyrics));
}

/**
 * Rank identity-qualified LRCLIB records:
 * synchronized + track language, then synchronized + other language,
 * then plain + track language, then plain + other language.
 */
export function selectBestLyricsCandidate(
  candidates: LyricsRankCandidate[],
  query: LyricsRankQuery,
): LyricsRankCandidate | null {
  const scored = candidates
    .filter(isUsableLyricsCandidate)
    .flatMap((candidate) => {
      const score = identityScore(candidate, query);
      if (score == null || score < IDENTITY_MIN_SCORE) return [];
      return [{
        candidate,
        score,
        synced: hasSyncedLyrics(candidate) ? 1 : 0,
        language: languageMatchRank(candidateLyricsText(candidate), query, candidate.lang),
        id: candidate.id ?? Number.MAX_SAFE_INTEGER,
      }];
    });

  if (scored.length === 0) return null;

  scored.sort((left, right) => (
    right.synced - left.synced
    || right.language - left.language
    || right.score - left.score
    || left.id - right.id
  ));
  return scored[0]?.candidate ?? null;
}

function nonempty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

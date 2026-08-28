import { LyricData } from '../types/lyrics';
import { hasCompleteRomanizedLyrics, parseLrc } from './lrc';
import { createRomanizedLrcAsync } from './romanize';

export const lyricsFingerprint = (lyrics: LyricData): string => {
  const source = lyrics.lines.length > 0
    ? lyrics.lines.map(line => `${line.timestamp.toFixed(3)}:${line.text}`).join('\n')
    : lyrics.plain_text ?? '';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const romanizedLyricsStorageKey = (trackId: string, lyrics: LyricData): string =>
  `nghenhacpromax:romanized:v2:${trackId}:${lyricsFingerprint(lyrics)}`;

const attachRomanizedLyrics = (original: LyricData, content: string): LyricData => {
  const romanized = parseLrc(content);
  const lines = original.lines.map(line => {
    const match = romanized.lines.find(candidate =>
      Math.abs(candidate.timestamp - line.timestamp) <= 1
    );
    return { ...line, romanized: match?.text ?? line.romanized };
  });

  return { ...original, lines, romanized };
};

/** Restores an imported version first, otherwise derives romanization from the original lyrics. */
export const hydrateRomanizedLyrics = async (trackId: string, lyrics: LyricData): Promise<LyricData> => {
  if (hasCompleteRomanizedLyrics(lyrics)) return lyrics;

  const storageKey = romanizedLyricsStorageKey(trackId, lyrics);
  const saved = localStorage.getItem(storageKey);
  if (saved?.trim()) {
    const restored = attachRomanizedLyrics(lyrics, saved);
    if (hasCompleteRomanizedLyrics(restored)) return restored;
  }

  const generated = await createRomanizedLrcAsync(lyrics);
  if (!generated) return lyrics;

  const hydrated = attachRomanizedLyrics(lyrics, generated);
  if (hasCompleteRomanizedLyrics(hydrated)) {
    try {
      localStorage.setItem(storageKey, generated);
    } catch (error) {
      console.warn('Could not cache generated romanized lyrics', error);
    }
  }
  return hydrated;
};

import { LyricData } from '../types/lyrics';
import { hasCompleteRomanizedLyrics, parseLrc } from './lrc';
import { createRomanizedLrcAsync } from './romanize';

const storageKey = (trackId: string) => `nghenhacpromax:romanized:${trackId}`;

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

  const saved = localStorage.getItem(storageKey(trackId));
  if (saved?.trim()) {
    const restored = attachRomanizedLyrics(lyrics, saved);
    if (hasCompleteRomanizedLyrics(restored)) return restored;
  }

  const generated = await createRomanizedLrcAsync(lyrics);
  if (!generated) return lyrics;

  const hydrated = attachRomanizedLyrics(lyrics, generated);
  if (hasCompleteRomanizedLyrics(hydrated)) {
    try {
      localStorage.setItem(storageKey(trackId), generated);
    } catch (error) {
      console.warn('Could not cache generated romanized lyrics', error);
    }
  }
  return hydrated;
};

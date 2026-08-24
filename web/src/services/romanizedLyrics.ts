import { LyricData } from '../types/lyrics';
import { parseLrc } from './lrc';
import { createRomanizedLrc } from './romanize';

const storageKey = (trackId: string) => `nghenhacpromax:romanized:${trackId}`;

const hasRomanizedLyrics = (lyrics: LyricData): boolean => Boolean(
  (lyrics.romanized &&
    ((lyrics.romanized.plain_text?.trim().length ?? 0) > 0 || lyrics.romanized.lines.length > 0)) ||
    lyrics.lines.some(line => Boolean(line.romanized?.trim()))
);

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
export const hydrateRomanizedLyrics = (trackId: string, lyrics: LyricData): LyricData => {
  if (hasRomanizedLyrics(lyrics)) return lyrics;

  const saved = localStorage.getItem(storageKey(trackId));
  if (saved?.trim()) return attachRomanizedLyrics(lyrics, saved);

  const generated = createRomanizedLrc(lyrics);
  return generated ? attachRomanizedLyrics(lyrics, generated) : lyrics;
};

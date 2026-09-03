import { LyricData, LyricLine, LyricsMode } from '../types/lyrics';
import { containsNonLatinLetters } from './romanize';

export function hasCompleteRomanizedLyrics(lyrics: LyricData): boolean {
  const companion = lyrics.romanized;
  if (companion?.lines.length) {
    const coversTimeline = lyrics.lines.length === 0 || companion.lines.length >= lyrics.lines.length;
    return coversTimeline && companion.lines.every(line => !containsNonLatinLetters(line.text));
  }
  if (companion?.plain_text?.trim()) {
    return !containsNonLatinLetters(companion.plain_text);
  }

  let foundRomanized = false;
  const complete = lyrics.lines.every(line => {
    if (!containsNonLatinLetters(line.text)) return true;
    if (!line.romanized?.trim() || containsNonLatinLetters(line.romanized)) return false;
    foundRomanized = true;
    return true;
  });
  return complete && foundRomanized;
}

/**
 * Normalizes backend IPC LyricsData response (which uses timestamp_ms) into frontend LyricData.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeLyricsData(raw: any): LyricData | null {
  if (!raw) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convertLines = (lines: any[]): LyricLine[] => {
    if (!Array.isArray(lines)) return [];
    return lines.map(line => {
      const ts =
        typeof line.timestamp === 'number'
          ? line.timestamp
          : typeof line.timestamp_ms === 'number'
          ? line.timestamp_ms / 1000
          : 0;

      return {
        timestamp: Math.max(0, ts),
        text: cleanLyricDisplayText(line.text || ''),
        romanized: line.romanized ? (cleanLyricDisplayText(line.romanized) || undefined) : undefined,
        translation: line.translation || undefined,
      };
    });
  };

  const lines = convertLines(raw.lines || []);
  const romanized = raw.romanized ? normalizeLyricsData(raw.romanized) || undefined : undefined;
  const plainText = typeof raw.plain_text === 'string' ? raw.plain_text : undefined;
  const instrumental = raw.instrumental === true
    || (typeof plainText === 'string' && plainText.trim().toLowerCase() === '[instrumental]');

  return {
    title: raw.title,
    artist: raw.artist,
    album: raw.album,
    by: raw.by,
    offset: raw.offset,
    lines,
    is_synced: raw.is_synced ?? lines.length > 0,
    plain_text: plainText,
    source: String(raw.source ?? '').toLowerCase() === 'lrclib' ? 'lrclib' : 'local',
    romanized,
    ...(instrumental ? { instrumental: true } : {}),
  };
}

/**
 * Strips karaoke markup LRCLIB/YouTube Music attach to synced lines:
 * `{agent:v1}`, `{bg}`, `v1:`, Enhanced LRC `<mm:ss.xx>`, and
 * `<word:start:end|word:start:end>` word timings.
 */
export function cleanLyricDisplayText(text: string): string {
  let value = text.trim();
  if (!value) return '';

  for (let i = 0; i < 8; i += 1) {
    const previous = value;
    value = value
      .replace(/\{agent:[^}]+\}/gi, '')
      .replace(/\{bg\}/gi, '')
      .replace(/^v\d+:\s*/i, '')
      .trim();
    const background = value.match(/^\[bg:\s*(.*)\]$/i);
    if (background?.[1] !== undefined) value = background[1].trim();
    if (value === previous) break;
  }

  value = value.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})>\s*/g, '');

  const reconstructed: string[] = [];
  value = value.replace(/<([^<>]+)>/g, (full, inner: string) => {
    const words = wordsFromLyricsPlusInner(inner);
    if (words.length === 0) return full;
    reconstructed.push(...words);
    return '';
  });

  value = value.replace(/\s+/g, ' ').trim();
  return value || reconstructed.join(' ');
}

function wordsFromLyricsPlusInner(inner: string): string[] {
  const words: string[] = [];
  for (const part of inner.split('|')) {
    const pieces = part.split(':');
    if (pieces.length < 3) return [];
    const end = pieces[pieces.length - 1] ?? '';
    const start = pieces[pieces.length - 2] ?? '';
    const word = pieces.slice(0, -2).join(':').trim();
    if (!/^\d+(?:\.\d+)?$/.test(start) || !/^\d+(?:\.\d+)?$/.test(end) || !word) {
      return [];
    }
    if (/^\d+$/.test(word) && word.length <= 3) return [];
    words.push(word);
  }
  return words;
}

function isKaraokeMarkup(text: string): boolean {
  return /\{agent:/i.test(text) || /\{bg\}/i.test(text) || /^v\d+:/i.test(text) || /<[^>]+>/.test(text);
}

/**
 * Parses raw LRC string content into structured LyricData.
 * Supports multiple timestamps per line, milliseconds, centiseconds, and metadata tags.
 */
export function parseLrc(content: string, romanizedContent?: string): LyricData {
  const lines: LyricLine[] = [];
  const metadata: Record<string, string> = {};
  let offset = 0; // ms offset

  const rawLines = content.split(/\r?\n/);
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const metaRegex = /\[([a-zA-Z]+):([^\]]+)\]/;

  // LRC offset is global even when the tag appears after timestamped lines.
  for (const rawLine of rawLines) {
    const match = rawLine.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (match) offset = parseInt(match[1], 10) || 0;
  }

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check for metadata tags e.g. [ti:Song Title]
    const metaMatch = line.match(metaRegex);
    if (metaMatch && !line.match(timeRegex)) {
      const tag = metaMatch[1].toLowerCase();
      const val = metaMatch[2].trim();
      metadata[tag] = val;
      continue;
    }

    // Extract all timestamp matches on this line
    const timeMatches = [...line.matchAll(timeRegex)];
    if (timeMatches.length > 0) {
      // Remove all timestamps from the line to get the lyric text
      const rawText = line.replace(timeRegex, '').trim();
      const text = cleanLyricDisplayText(rawText);
      if (!text && isKaraokeMarkup(rawText)) continue;

      for (const match of timeMatches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        let fraction = 0;
        if (match[3]) {
          const fracStr = match[3];
          if (fracStr.length === 2) {
            fraction = parseInt(fracStr, 10) / 100;
          } else if (fracStr.length === 3) {
            fraction = parseInt(fracStr, 10) / 1000;
          } else {
            fraction = parseInt(fracStr, 10) / 10;
          }
        }

        const totalSeconds = minutes * 60 + seconds + fraction + offset / 1000;
        lines.push({
          timestamp: Math.max(0, totalSeconds),
          text: text,
        });
      }
    }
  }

  // Sort lines by ascending timestamp
  lines.sort((a, b) => a.timestamp - b.timestamp);

  let romanized: LyricData | undefined;
  if (romanizedContent && romanizedContent.trim()) {
    romanized = parseLrc(romanizedContent);
    if (romanized.is_synced && lines.length > 0) {
      // Match lines by timestamp
      for (const origLine of lines) {
        const match = romanized.lines.find(
          rom => Math.abs(origLine.timestamp - rom.timestamp) <= 1.0
        );
        if (match) {
          origLine.romanized = match.text;
        }
      }
    }
  }

  return {
    title: metadata['ti'],
    artist: metadata['ar'],
    album: metadata['al'],
    by: metadata['by'],
    offset,
    lines,
    is_synced: lines.length > 0,
    plain_text: content,
    romanized,
  };
}

/**
 * Finds the index of the active lyric line for a given timestamp.
 */
export function findActiveLyricIndex(lines: LyricLine[], currentSeconds: number): number {
  if (!lines || lines.length === 0) return -1;
  if (currentSeconds < lines[0].timestamp) return -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (currentSeconds >= lines[i].timestamp) {
      return i;
    }
  }

  return 0;
}

/**
 * Computes the valid/effective lyrics mode for given lyric data.
 * - If no romanized data is available, strictly coerced to 'original'.
 * - If only romanized data exists (no original lines or plain text), coerced to 'romanized'.
 * - If both exist and preferredMode is valid, preserves preferredMode; defaults to 'both'.
 */
export function computeEffectiveLyricsMode(
  lyricsData: LyricData | null,
  preferredMode?: LyricsMode
): LyricsMode {
  if (!lyricsData) return 'original';

  const hasOriginal = Boolean(
    (lyricsData.plain_text && lyricsData.plain_text.trim().length > 0) ||
      (lyricsData.lines && lyricsData.lines.length > 0)
  );

  const hasRomanized = hasCompleteRomanizedLyrics(lyricsData);

  if (!hasRomanized) {
    return 'original';
  }

  if (!hasOriginal) {
    return 'romanized';
  }

  if (preferredMode === 'original' || preferredMode === 'romanized' || preferredMode === 'both') {
    return preferredMode;
  }

  return 'both';
}

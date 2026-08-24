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
        text: line.text || '',
        romanized: line.romanized || undefined,
        translation: line.translation || undefined,
      };
    });
  };

  const lines = convertLines(raw.lines || []);
  const romanized = raw.romanized ? normalizeLyricsData(raw.romanized) || undefined : undefined;

  return {
    title: raw.title,
    artist: raw.artist,
    album: raw.album,
    by: raw.by,
    offset: raw.offset,
    lines,
    is_synced: raw.is_synced ?? lines.length > 0,
    plain_text: raw.plain_text,
    romanized,
  };
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
      const text = line.replace(timeRegex, '').trim();

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

export interface ParsedLyricLine {
  timestamp_seconds: number;
  text: string;
}

export interface ParsedLyrics {
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  offset: number;
  lines: ParsedLyricLine[];
  is_synced: boolean;
  plain_text: string;
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
 * Parses synced LRC. Timestamps are seconds from the start of the track.
 * Supports mm:ss, mm:ss.xx (centiseconds), and mm:ss.xxx (milliseconds).
 */
export function parseLrc(content: string): ParsedLyrics {
  const lines: ParsedLyricLine[] = [];
  const metadata: Record<string, string> = {};
  let offset = 0;

  const rawLines = content.split(/\r?\n/);
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const metaRegex = /\[([a-zA-Z]+):([^\]]+)\]/;

  for (const rawLine of rawLines) {
    const match = rawLine.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
    if (match?.[1]) offset = parseInt(match[1], 10) || 0;
  }

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;

    const metaMatch = line.match(metaRegex);
    if (metaMatch && !line.match(timeRegex) && metaMatch[1] && metaMatch[2] !== undefined) {
      metadata[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    const timeMatches = [...line.matchAll(timeRegex)];
    if (timeMatches.length === 0) continue;

    const rawText = line.replace(timeRegex, '').trim();
    const text = cleanLyricDisplayText(rawText);
    if (!text && isKaraokeMarkup(rawText)) continue;

    for (const match of timeMatches) {
      const minutes = parseInt(match[1] ?? '0', 10);
      const seconds = parseInt(match[2] ?? '0', 10);
      let fraction = 0;
      const fracStr = match[3];
      if (fracStr) {
        if (fracStr.length === 2) fraction = parseInt(fracStr, 10) / 100;
        else if (fracStr.length === 3) fraction = parseInt(fracStr, 10) / 1000;
        else fraction = parseInt(fracStr, 10) / 10;
      }
      lines.push({
        timestamp_seconds: Math.max(0, minutes * 60 + seconds + fraction + offset / 1000),
        text,
      });
    }
  }

  lines.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);

  return {
    title: metadata.ti,
    artist: metadata.ar,
    album: metadata.al,
    by: metadata.by,
    offset,
    lines,
    is_synced: lines.length > 0,
    plain_text: content,
  };
}

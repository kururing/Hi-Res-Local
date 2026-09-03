import { parseLrc, type ParsedLyrics } from '../lyrics/parseLrc.js';

export interface EmbeddedLyrics {
  kind: 'synced' | 'plain';
  parsed: ParsedLyrics;
  synced_lrc: string | null;
  plain_text: string;
}

const LYRIC_ALIASES = [
  'lyrics',
  'unsyncedlyrics',
  'unsynced lyrics',
  'unsychronisedlyrics',
  'unsynchronizedlyrics',
  'lyric',
  'uslt',
  '©lyr',
  'sylt',
];

export function lookupLyricsTag(map: Map<string, string>): string | null {
  for (const alias of LYRIC_ALIASES) {
    const compact = alias.replace(/\s+/g, '');
    const value = map.get(alias) ?? map.get(compact);
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function looksLikeLrc(text: string): boolean {
  return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);
}

export function detectEmbeddedLyrics(map: Map<string, string>): EmbeddedLyrics | null {
  const raw = lookupLyricsTag(map);
  if (!raw) return null;
  try {
    if (looksLikeLrc(raw)) {
      const parsed = parseLrc(raw);
      if (parsed.is_synced && parsed.lines.length > 0) {
        return {
          kind: 'synced',
          parsed,
          synced_lrc: raw,
          plain_text: parsed.lines.map((line) => line.text).join('\n'),
        };
      }
    }
    const parsed = parseLrc(raw);
    return {
      kind: 'plain',
      parsed: { ...parsed, is_synced: false, lines: [] },
      synced_lrc: null,
      plain_text: raw,
    };
  } catch {
    return null;
  }
}

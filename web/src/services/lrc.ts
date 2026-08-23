import { LyricData, LyricLine } from '../types/lyrics';

/**
 * Parses raw LRC string content into structured LyricData.
 * Supports multiple timestamps per line, milliseconds, centiseconds, and metadata tags.
 */
export function parseLrc(content: string): LyricData {
  const lines: LyricLine[] = [];
  const metadata: Record<string, string> = {};
  let offset = 0; // ms offset

  const rawLines = content.split(/\r?\n/);
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const metaRegex = /\[([a-zA-Z]+):([^\]]+)\]/;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check for metadata tags e.g. [ti:Song Title]
    const metaMatch = line.match(metaRegex);
    if (metaMatch && !line.match(timeRegex)) {
      const tag = metaMatch[1].toLowerCase();
      const val = metaMatch[2].trim();
      metadata[tag] = val;
      if (tag === 'offset') {
        offset = parseInt(val, 10) || 0;
      }
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

  return {
    title: metadata['ti'],
    artist: metadata['ar'],
    album: metadata['al'],
    by: metadata['by'],
    offset,
    lines,
    is_synced: lines.length > 0,
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

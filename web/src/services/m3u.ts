import { Track } from '../types/library';
import { Playlist } from '../types/playlist';

export interface ParsedM3uEntry {
  title?: string;
  artist?: string;
  duration?: number;
  path: string;
}

/**
 * Parses an M3U or Extended M3U playlist file content.
 */
export function parseM3u(content: string): ParsedM3uEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: ParsedM3uEntry[] = [];
  let currentTitle: string | undefined;
  let currentArtist: string | undefined;
  let currentDuration: number | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXTM3U')) {
      continue;
    }

    if (trimmed.startsWith('#EXTINF:')) {
      // Format: #EXTINF:123,Artist - Title or #EXTINF:123,Title
      const infoPart = trimmed.substring(8);
      const commaIdx = infoPart.indexOf(',');
      if (commaIdx !== -1) {
        const durStr = infoPart.substring(0, commaIdx).trim();
        currentDuration = parseInt(durStr, 10);
        if (isNaN(currentDuration) || currentDuration < 0) {
          currentDuration = undefined;
        }

        const namePart = infoPart.substring(commaIdx + 1).trim();
        const dashIdx = namePart.indexOf(' - ');
        if (dashIdx !== -1) {
          currentArtist = namePart.substring(0, dashIdx).trim();
          currentTitle = namePart.substring(dashIdx + 3).trim();
        } else {
          currentTitle = namePart;
        }
      }
      continue;
    }

    if (!trimmed.startsWith('#')) {
      // This is a file path / URI
      entries.push({
        path: trimmed,
        title: currentTitle,
        artist: currentArtist,
        duration: currentDuration,
      });

      currentTitle = undefined;
      currentArtist = undefined;
      currentDuration = undefined;
    }
  }

  return entries;
}

/**
 * Exports a Playlist and its tracks as an Extended M3U formatted string.
 */
export function generateM3u(playlist: Playlist, tracks: Track[]): string {
  const trackMap = new Map(tracks.map(t => [t.id, t]));
  let result = '#EXTM3U\n';
  result += `#PLAYLIST:${playlist.name}\n`;
  if (playlist.description) {
    result += `#COMMENT:${playlist.description}\n`;
  }

  for (const tid of playlist.track_ids) {
    const track = trackMap.get(tid);
    if (track) {
      const durSec = Math.round(track.duration);
      result += `#EXTINF:${durSec},${track.artist} - ${track.title}\n`;
      result += `${track.path}\n`;
    }
  }

  return result;
}

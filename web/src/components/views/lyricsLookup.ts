import { normalizeLyricsData, parseLrc } from '../../services/lrc';
import { pickPreferredLyrics } from '../../services/lyricsRank';
import type { LyricsApi } from '../../platform/contracts';
import type { Track } from '../../types/library';
import type { LyricData } from '../../types/lyrics';

export type LyricsLookupTrack = Pick<
  Track,
  'id' | 'title' | 'artist' | 'album' | 'duration' | 'duration_ms' | 'lyrics' | 'genre'
>;

export function remoteLyricsCacheKey(
  track: Pick<Track, 'title' | 'artist' | 'album' | 'duration' | 'duration_ms'>
): string {
  const normalize = (value: string): string => value.trim().toLocaleLowerCase();
  const identity = [
    normalize(track.title),
    normalize(track.artist),
    normalize(track.album),
    Math.round(trackDurationSeconds(track)),
  ];
  return `nghenhac_lrclib_lyrics:v5:${JSON.stringify(identity)}`;
}

export function trackDurationSeconds(track: Pick<Track, 'duration' | 'duration_ms'>): number {
  if (typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0) {
    return track.duration;
  }
  return Math.max(0, (track.duration_ms ?? 0) / 1000);
}

function readCachedRemoteLyrics(track: LyricsLookupTrack): LyricData | null {
  try {
    const cached = localStorage.getItem(remoteLyricsCacheKey(track));
    if (!cached) return null;
    return normalizeLyricsData(JSON.parse(cached));
  } catch {
    return null;
  }
}

function writeCachedRemoteLyrics(track: LyricsLookupTrack, lyrics: LyricData): void {
  try {
    localStorage.setItem(remoteLyricsCacheKey(track), JSON.stringify(lyrics));
  } catch {
    // Caching is optional; lyrics can still be displayed this time.
  }
}

export async function fetchCachedOrRemoteLyrics(
  track: LyricsLookupTrack,
  lyricsApi: LyricsApi
): Promise<LyricData | null> {
  const cached = readCachedRemoteLyrics(track);
  if (cached?.is_synced && cached.lines.length > 0) return cached;

  try {
    const remote = await lyricsApi.fetchRemoteLyrics({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: trackDurationSeconds(track),
      ...(track.genre ? { genre: track.genre } : {}),
    });
    if (!remote) return cached;
    writeCachedRemoteLyrics(track, remote);
    return normalizeLyricsData(remote);
  } catch (error) {
    console.warn('Failed to load lyrics from LRCLIB', error);
    return cached;
  }
}

/**
 * Loads lyrics for the current track. Callers must ignore the result when
 * `isCurrent` is false so a slower previous request cannot overwrite a newer track.
 */
export async function resolveLyricsForTrack(
  track: LyricsLookupTrack,
  lyricsApi: LyricsApi,
  isCurrent: () => boolean,
  hydrate: (trackId: string, lyrics: LyricData) => Promise<LyricData>
): Promise<LyricData | null> {
  const hydrateIfCurrent = async (lyrics: LyricData | null): Promise<LyricData | null> => {
    if (!lyrics || !isCurrent()) return null;
    const hydrated = await hydrate(track.id, lyrics);
    return isCurrent() ? hydrated : null;
  };

  let storedLyrics: LyricData | null = null;
  let embeddedLyrics: LyricData | null = null;

  try {
    const stored = await lyricsApi.getTrackLyrics(track.id);
    if (!isCurrent()) return null;

    if (stored) {
      storedLyrics = normalizeLyricsData(stored);
    }
  } catch (error) {
    if (!isCurrent()) return null;
    console.warn('Failed to load lyrics', error);
  }

  if (track.lyrics) {
    embeddedLyrics = parseLrc(track.lyrics);
  }

  const remote = await fetchCachedOrRemoteLyrics(track, lyricsApi);
  if (!isCurrent()) return null;

  return hydrateIfCurrent(pickPreferredLyrics([
    remote ? { lyrics: remote, source: 'remote' } : null,
    storedLyrics ? { lyrics: storedLyrics, source: 'stored' } : null,
    embeddedLyrics ? { lyrics: embeddedLyrics, source: 'embedded' } : null,
  ], track));
}

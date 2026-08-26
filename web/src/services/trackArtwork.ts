import { Track } from '../types/library';
import { isTauri } from './ipc';
import { getCachedArtwork } from './remoteArtwork';

const isDirectSource = (value: string) => /^(data:|blob:|https?:\/\/)/i.test(value);

export const resolveTrackArtworkSource = async (track: Track | null): Promise<string | null> => {
  if (!track) return null;

  if (track.cover_art_path) {
    if (isDirectSource(track.cover_art_path)) return track.cover_art_path;
    if (isTauri()) {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      return convertFileSrc(track.cover_art_path);
    }
  }

  return getCachedArtwork('album', track.artist, track.album);
};

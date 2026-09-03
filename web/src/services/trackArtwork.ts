import { Track } from '../types/library';
import type { ArtworkAssetsApi } from '../platform/contracts';
import { getCachedArtwork } from './remoteArtwork';

export const resolveTrackArtworkSource = async (
  track: Track | null,
  artworkAssets: ArtworkAssetsApi,
): Promise<string | null> => {
  if (!track) return null;

  if (track.cover_art_path) {
    const resolved = await artworkAssets.resolveDisplaySource(track.cover_art_path);
    if (resolved) return resolved;
  }

  return getCachedArtwork('album', track.artist, track.album);
};

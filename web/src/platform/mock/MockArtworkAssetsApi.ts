import { resolveBrowserArtworkSource } from '../artwork/displaySource';
import type { ArtworkAssetsApi } from '../contracts';

/**
 * Mock preview: web/data/blob URLs work in Vite. Apple Music native lookup is
 * skipped so the public iTunes fallback remains available.
 */
export class MockArtworkAssetsApi implements ArtworkAssetsApi {
  async resolveDisplaySource(source: string | null | undefined): Promise<string | null> {
    return resolveBrowserArtworkSource(source);
  }

  async getAppleMusicArtistArtwork(
    _country: string,
    _artistId: number,
  ): Promise<string | null> {
    return null;
  }

  cacheRemoteArtwork(_cacheKey: string, dataUrl: string): Promise<string> {
    return Promise.resolve(dataUrl);
  }

  clearRemoteArtworkCache(): Promise<void> {
    return Promise.resolve();
  }
}

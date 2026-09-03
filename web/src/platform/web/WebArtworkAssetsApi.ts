import { ArtworkCacheError, type ArtworkAssetsApi } from '../contracts';
import { resolveBrowserArtworkSource } from '../artwork/displaySource';
import { isLocalFilePath } from './WebLibraryApi';

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+[;,]/i;

export function isArtworkImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL.test(value.trim());
}

/**
 * Browser runtime: keep web/data/blob URLs, never treat filesystem paths as
 * image sources, and never send local artwork to the cloud API.
 */
export class WebArtworkAssetsApi implements ArtworkAssetsApi {
  async resolveDisplaySource(source: string | null | undefined): Promise<string | null> {
    if (source == null) return null;
    const value = source.trim();
    if (!value) return null;
    if (isLocalFilePath(value)) return null;
    return resolveBrowserArtworkSource(value);
  }

  async getAppleMusicArtistArtwork(
    _country: string,
    _artistId: number,
  ): Promise<string | null> {
    return null;
  }

  async cacheRemoteArtwork(_cacheKey: string, dataUrl: string): Promise<string> {
    const value = dataUrl.trim();
    if (!isArtworkImageDataUrl(value)) {
      throw new ArtworkCacheError(
        'Artwork cache only accepts image data URLs in the web runtime.'
      );
    }
    return value;
  }

  async clearRemoteArtworkCache(): Promise<void> {
    return undefined;
  }
}

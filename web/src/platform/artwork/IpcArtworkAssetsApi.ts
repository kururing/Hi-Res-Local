import type { ArtworkAssetsApi, PlatformCommandGateway } from '../contracts';
import { isDirectArtworkSource, resolveBrowserArtworkSource } from './displaySource';

/** IPC-backed remote artwork cache for the Tauri desktop runtime. */
export class IpcArtworkAssetsApi implements ArtworkAssetsApi {
  constructor(protected readonly commands: PlatformCommandGateway) {}

  async resolveDisplaySource(source: string | null | undefined): Promise<string | null> {
    return resolveBrowserArtworkSource(source);
  }

  getAppleMusicArtistArtwork(country: string, artistId: number): Promise<string | null> {
    return this.commands.invoke('get_apple_music_artist_artwork', { country, artistId });
  }

  cacheRemoteArtwork(cacheKey: string, dataUrl: string): Promise<string> {
    return this.commands.invoke('cache_image_data', {
      cacheKey,
      category: 'remote-artwork',
      dataUrl,
    });
  }

  clearRemoteArtworkCache(): Promise<void> {
    return this.commands.invoke('clear_image_cache', { category: 'remote-artwork' });
  }
}

/** Desktop artwork: local paths become webview-safe asset URLs. */
export class TauriArtworkAssetsApi extends IpcArtworkAssetsApi {
  async resolveDisplaySource(source: string | null | undefined): Promise<string | null> {
    if (source == null) return null;
    const value = source.trim();
    if (!value) return null;
    if (isDirectArtworkSource(value)) return value;
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      return convertFileSrc(value);
    } catch (error) {
      console.warn('Failed to resolve local artwork for display', error);
      return null;
    }
  }

  async cacheRemoteArtwork(cacheKey: string, dataUrl: string): Promise<string> {
    const cachedPath = await super.cacheRemoteArtwork(cacheKey, dataUrl);
    if (isDirectArtworkSource(cachedPath)) return cachedPath;
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    return convertFileSrc(cachedPath);
  }
}

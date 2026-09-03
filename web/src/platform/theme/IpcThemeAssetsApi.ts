import type { CacheThemeImageInput, PlatformCommandGateway, ThemeAssetsApi } from '../contracts';

/** IPC-backed theme image cache for the Tauri desktop runtime. */
export class IpcThemeAssetsApi implements ThemeAssetsApi {
  constructor(protected readonly commands: PlatformCommandGateway) {}

  cacheImage(input: CacheThemeImageInput): Promise<string> {
    return this.commands.invoke('cache_image_data', {
      cacheKey: input.cacheKey,
      category: input.category,
      dataUrl: input.dataUrl,
    });
  }
}

/** Desktop cache writes a file and returns a webview-safe asset URL. */
export class TauriThemeAssetsApi extends IpcThemeAssetsApi {
  async cacheImage(input: CacheThemeImageInput): Promise<string> {
    const cachedPath = await super.cacheImage(input);
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    return convertFileSrc(cachedPath);
  }
}

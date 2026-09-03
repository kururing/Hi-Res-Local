import type { CacheThemeImageInput, ThemeAssetsApi } from '../contracts';

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+[;,]/i;

export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL.test(value.trim());
}

/**
 * Browser runtime has no filesystem image cache. Validated image data URLs are
 * returned as-is until a cloud asset API exists. Non-image payloads are
 * rejected so local paths never leak into theme storage.
 */
export class WebThemeAssetsApi implements ThemeAssetsApi {
  async cacheImage(input: CacheThemeImageInput): Promise<string> {
    const dataUrl = input.dataUrl.trim();
    if (!isImageDataUrl(dataUrl)) {
      throw new Error('Theme cache only accepts image data URLs in the web runtime.');
    }
    return dataUrl;
  }
}

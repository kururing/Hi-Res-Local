import type { CacheThemeImageInput, ThemeAssetsApi } from '../contracts';

/** Mock preview returns the data URL itself; there is no filesystem cache. */
export class MockThemeAssetsApi implements ThemeAssetsApi {
  cacheImage(input: CacheThemeImageInput): Promise<string> {
    return Promise.resolve(input.dataUrl);
  }
}

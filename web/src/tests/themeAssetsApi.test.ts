import { describe, expect, it, vi } from 'vitest';
import type { PlatformCommandGateway } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { MockThemeAssetsApi } from '../platform/mock/MockThemeAssetsApi';
import { TauriThemeAssetsApi } from '../platform/theme/IpcThemeAssetsApi';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { isImageDataUrl, WebThemeAssetsApi } from '../platform/web/WebThemeAssetsApi';

const { mockConvertFileSrc } = vi.hoisted(() => ({
  mockConvertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => mockConvertFileSrc(path),
}));

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('TauriThemeAssetsApi', () => {
  it('caches through IPC and returns a webview asset URL, not a raw filesystem path', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriThemeAssetsApi(commands);
    invoke.mockResolvedValueOnce('C:/Users/bang/AppData/theme.png');

    const result = await api.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: pngDataUrl,
    });

    expect(invoke).toHaveBeenCalledWith('cache_image_data', {
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: pngDataUrl,
    });
    expect(mockConvertFileSrc).toHaveBeenCalledWith('C:/Users/bang/AppData/theme.png');
    expect(result).toBe('asset://C:/Users/bang/AppData/theme.png');
    expect(result).not.toMatch(/^[A-Za-z]:[\\/]/);
  });
});

describe('MockThemeAssetsApi', () => {
  it('returns the data URL from the preview cache', async () => {
    const api = new MockThemeAssetsApi();

    await expect(api.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: pngDataUrl,
    })).resolves.toBe(pngDataUrl);
  });
});

describe('platform wiring', () => {
  it('exposes the matching theme assets adapter on each runtime', () => {
    expect(createTauriPlatform().themeAssets).toBeInstanceOf(TauriThemeAssetsApi);
    expect(createMockPlatform().themeAssets).toBeInstanceOf(MockThemeAssetsApi);
    expect(createWebPlatform('/api').themeAssets).toBeInstanceOf(WebThemeAssetsApi);
    expect(createTauriPlatform().capabilities.themeImageCache).toBe(true);
    expect(createMockPlatform().capabilities.themeImageCache).toBe(true);
    expect(createWebPlatform('/api').capabilities.themeImageCache).toBe(false);
  });
});

describe('WebThemeAssetsApi', () => {
  it('accepts image data URLs and does not return a filesystem path', async () => {
    const api = new WebThemeAssetsApi();
    const result = await api.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: pngDataUrl,
    });

    expect(isImageDataUrl(result)).toBe(true);
    expect(result).toBe(pngDataUrl);
    expect(result).not.toMatch(/^[A-Za-z]:[\\/]/);
    expect(result).not.toMatch(/^file:/);
    expect(result).not.toMatch(/C:\\/);
  });

  it('rejects non-image data URLs and local paths', async () => {
    const api = new WebThemeAssetsApi();

    await expect(api.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: 'data:text/plain;base64,SGVsbG8=',
    })).rejects.toThrow(/image data URLs/i);

    await expect(api.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: 'C:/Users/bang/Pictures/theme.png',
    })).rejects.toThrow(/image data URLs/i);

    await expect(api.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: 'https://cdn.example.test/theme.png',
    })).rejects.toThrow(/image data URLs/i);
  });
});

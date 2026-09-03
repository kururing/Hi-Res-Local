import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtworkAssetsApi } from '../platform/contracts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  abort() {}

  readAsDataURL() {
    this.result = 'data:image/jpeg;base64,AA==';
    queueMicrotask(() => this.onload?.({} as ProgressEvent<FileReader>));
  }
}

const albumResults = {
  results: [
    {
      artistId: 101,
      artistName: 'Echo',
      collectionName: 'Another Album',
      artworkUrl100: 'https://images.example/wrong/100x100bb.jpg',
    },
    {
      artistId: 202,
      artistName: 'Echo',
      collectionName: 'Right Album',
      artworkUrl100: 'https://images.example/right/100x100bb.jpg',
    },
  ],
};

function createArtworkAssets(overrides: Partial<ArtworkAssetsApi> = {}): ArtworkAssetsApi & {
  getAppleMusicArtistArtwork: ReturnType<typeof vi.fn>;
  cacheRemoteArtwork: ReturnType<typeof vi.fn>;
  clearRemoteArtworkCache: ReturnType<typeof vi.fn>;
} {
  const getAppleMusicArtistArtwork = vi.fn(overrides.getAppleMusicArtistArtwork ?? (async (_country: string, artistId: number) => (
    `https://images.example/artist-${artistId}/600x600bb.jpg`
  )));
  const cacheRemoteArtwork = vi.fn(overrides.cacheRemoteArtwork ?? (async (key: string) => `asset://C:/cache/${key}.jpg`));
  const clearRemoteArtworkCache = vi.fn(overrides.clearRemoteArtworkCache ?? (async () => undefined));

  return {
    resolveDisplaySource: overrides.resolveDisplaySource ?? (async source => source ?? null),
    getAppleMusicArtistArtwork,
    cacheRemoteArtwork,
    clearRemoteArtworkCache,
  };
}

describe('artist artwork identity', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader });
  });

  it('invalidates only artist images cached by the old matcher', async () => {
    localStorage.setItem('nghenhac_remote_artwork_itunes_v3', JSON.stringify({
      'artist:echo:': 'asset://old-wrong-artist.jpg',
      'album:echo:right album': 'asset://existing-album.jpg',
    }));

    const { getCachedArtwork } = await import('../services/remoteArtwork');

    expect(getCachedArtwork('artist', 'Echo')).toBeNull();
    expect(getCachedArtwork('album', 'Echo', 'Right Album')).toBe('asset://existing-album.jpg');
  });

  it('uses the album match to disambiguate artists with the same name', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith('https://itunes.apple.com/search')) {
        return { ok: true, json: async () => albumResults };
      }
      return { ok: true, blob: async () => new Blob(['image'], { type: 'image/jpeg' }) };
    }));

    const artworkAssets = createArtworkAssets();
    const { downloadArtwork } = await import('../services/remoteArtwork');
    const source = await downloadArtwork('artist', 'Echo', undefined, artworkAssets, undefined, 'Right Album');

    expect(source).toContain('asset://');
    expect(requestedUrls.some(url => url.includes('entity=album'))).toBe(true);
    expect(requestedUrls.some(url => url.includes('entity=musicArtist'))).toBe(false);
    expect(artworkAssets.getAppleMusicArtistArtwork).toHaveBeenCalledWith('vn', 202);
    expect(artworkAssets.cacheRemoteArtwork).toHaveBeenCalled();
  });

  it.each([
    {
      artist: 'D.O.',
      albumHint: "괜찮아도 괜찮아 That's okay",
      remoteAlbum: "That's okay - Single",
      artistId: 1364148883,
    },
    {
      artist: 'Epik High',
      albumHint: 'Moonlovers: Scarlet Heart Ryeo (Original Television Soundtrack)',
      remoteAlbum: 'Moonlovers: Scarlet Heart Ryeo, Pt. 6 (Original Television Soundtrack) - Single',
      artistId: 139334133,
    },
  ])('accepts an unambiguous album-search artist for $artist when release titles differ', async ({
    artist,
    albumHint,
    remoteAlbum,
    artistId,
  }) => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith('https://itunes.apple.com/search')) {
        return {
          ok: true,
          json: async () => ({
            results: [{ artistId, artistName: artist, collectionName: remoteAlbum }],
          }),
        };
      }
      return { ok: true, blob: async () => new Blob(['image'], { type: 'image/jpeg' }) };
    }));

    const artworkAssets = createArtworkAssets();
    const { downloadArtwork } = await import('../services/remoteArtwork');
    const source = await downloadArtwork('artist', artist, undefined, artworkAssets, undefined, albumHint);

    expect(source).toContain('asset://');
    expect(requestedUrls.some(url => url.includes('entity=musicArtist'))).toBe(false);
    expect(artworkAssets.getAppleMusicArtistArtwork).toHaveBeenCalledWith('vn', artistId);
  });

  it('reuses artist ID evidence collected while downloading an album', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith('https://itunes.apple.com/search')) {
        return { ok: true, json: async () => albumResults };
      }
      return { ok: true, blob: async () => new Blob(['image'], { type: 'image/jpeg' }) };
    }));

    const artworkAssets = createArtworkAssets();
    const { downloadArtwork } = await import('../services/remoteArtwork');
    await downloadArtwork('album', 'Echo', 'Right Album', artworkAssets);
    requestedUrls.length = 0;
    await downloadArtwork('artist', 'Echo', undefined, artworkAssets);

    expect(requestedUrls.some(url => url.includes('itunes.apple.com'))).toBe(false);
    expect(artworkAssets.getAppleMusicArtistArtwork).toHaveBeenCalledWith('vn', 202);
  });

  it('does not use album artwork when Apple Music lookup returns null', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith('https://itunes.apple.com/search')) {
        return { ok: true, json: async () => albumResults };
      }
      if (url.startsWith('https://itunes.apple.com/lookup')) {
        return {
          ok: true,
          json: async () => ({
            results: [{
              artistId: 202,
              artistName: 'Echo',
              artworkUrl100: 'https://images.example/fallback/100x100bb.jpg',
            }],
          }),
        };
      }
      return { ok: true, blob: async () => new Blob(['image'], { type: 'image/jpeg' }) };
    }));

    const artworkAssets = createArtworkAssets({
      getAppleMusicArtistArtwork: async () => null,
    });
    const { downloadArtwork } = await import('../services/remoteArtwork');
    const source = await downloadArtwork('artist', 'Echo', undefined, artworkAssets, undefined, 'Right Album');

    expect(source).toBeNull();
    expect(requestedUrls.some(url => url.includes('itunes.apple.com/lookup'))).toBe(false);
    expect(artworkAssets.getAppleMusicArtistArtwork).toHaveBeenCalledWith('vn', 202);
  });

  it('clears native artwork cache through the injected adapter', async () => {
    const artworkAssets = createArtworkAssets();
    const { clearArtworkCache } = await import('../services/remoteArtwork');
    clearArtworkCache(artworkAssets);
    expect(artworkAssets.clearRemoteArtworkCache).toHaveBeenCalledTimes(1);
  });
});

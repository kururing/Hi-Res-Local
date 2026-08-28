import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../services/ipc', () => ({
  isTauri: () => true,
  IpcService: { invoke: mocks.invoke },
}));

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

describe('artist artwork identity', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader });

    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'get_apple_music_artist_artwork') {
        return `https://images.example/artist-${args.artistId}/600x600bb.jpg`;
      }
      if (command === 'cache_image_data') {
        return `C:/cache/${args.cacheKey}.jpg`;
      }
      return null;
    });
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

    const { downloadArtwork } = await import('../services/remoteArtwork');
    const source = await downloadArtwork('artist', 'Echo', undefined, undefined, 'Right Album');

    expect(source).toContain('asset://');
    expect(requestedUrls.some(url => url.includes('entity=album'))).toBe(true);
    expect(requestedUrls.some(url => url.includes('entity=musicArtist'))).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith('get_apple_music_artist_artwork', {
      country: 'vn',
      artistId: 202,
    });
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

    const { downloadArtwork } = await import('../services/remoteArtwork');
    const source = await downloadArtwork('artist', artist, undefined, undefined, albumHint);

    expect(source).toContain('asset://');
    expect(requestedUrls.some(url => url.includes('entity=musicArtist'))).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith('get_apple_music_artist_artwork', {
      country: 'vn',
      artistId,
    });
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

    const { downloadArtwork } = await import('../services/remoteArtwork');
    await downloadArtwork('album', 'Echo', 'Right Album');
    requestedUrls.length = 0;
    await downloadArtwork('artist', 'Echo');

    expect(requestedUrls.some(url => url.includes('itunes.apple.com'))).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith('get_apple_music_artist_artwork', {
      country: 'vn',
      artistId: 202,
    });
  });
});

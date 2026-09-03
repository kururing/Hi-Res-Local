import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MockRuntime } from '../platform/mock/MockRuntime';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('mock compatibility gateway', () => {
  it('rejects leftover lyrics commands with a clear error', async () => {
    const runtime = new MockRuntime({ persist: false });
    await expect(runtime.commands.invoke('get_track_lyrics', { trackId: 'track-1' }))
      .rejects.toThrow(/Unknown mock command: get_track_lyrics/);
    await expect(runtime.commands.invoke('fetch_lrclib_lyrics', { trackId: 'track-1' }))
      .rejects.toThrow(/Unknown mock command: fetch_lrclib_lyrics/);
  });

  it('shares playlist state between compatibility commands and direct Mock APIs', async () => {
    const runtime = new MockRuntime({ persist: false });
    const created = await runtime.commands.invoke('create_playlist', {
      input: { name: 'Bridge Mix' },
    });
    const listed = await runtime.playlists.list();
    expect(listed.some(playlist => playlist.id === created.id && playlist.name === 'Bridge Mix')).toBe(true);
  });

  it('reports unknown commands clearly', async () => {
    const runtime = new MockRuntime({ persist: false });
    await expect(runtime.commands.invoke('get_track_by_id', { id: 'track-1' }))
      .rejects.toThrow(/Unknown mock command: get_track_by_id/);
  });

  it('does not keep giant mock state or a domain handler in ipc.ts', () => {
    const contents = source('../services/ipc.ts');
    expect(contents).not.toMatch(/MOCK_TRACKS/);
    expect(contents).not.toMatch(/MOCK_PLAYLISTS/);
    expect(contents).not.toMatch(/mockInvokeHandler/);
    expect(contents).not.toMatch(/from ['"]\.\/mock['"]/);
    expect(contents).not.toMatch(/from ['"]\.\/storage['"]/);
    expect(contents).toMatch(/getDefaultMockRuntime/);
    expect(contents).not.toMatch(/get_track_lyrics|fetch_lrclib_lyrics|parseLrc/);
  });
});

describe('mock architecture boundaries', () => {
  it('keeps MockPlatform and mock domain adapters off IpcService', () => {
    const files = [
      '../platform/mock/MockPlatform.ts',
      '../platform/mock/MockLibraryApi.ts',
      '../platform/mock/MockPlaylistApi.ts',
      '../platform/mock/MockFavoritesApi.ts',
      '../platform/mock/MockHistoryApi.ts',
      '../platform/mock/MockLyricsApi.ts',
      '../platform/mock/MockAudioConfigurationApi.ts',
      '../platform/mock/MockThemeAssetsApi.ts',
      '../platform/mock/MockArtworkAssetsApi.ts',
      '../platform/mock/MockBackupApi.ts',
      '../platform/mock/MockPresenceApi.ts',
      '../platform/mock/MockAutostartApi.ts',
      '../platform/mock/MockDataStore.ts',
      '../platform/mock/MockEventBus.ts',
      '../platform/mock/MockRuntime.ts',
      '../platform/mock/MockCommandGateway.ts',
    ];
    for (const file of files) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/from ['"][^'"]*services\/ipc['"]/);
      expect(contents, file).not.toMatch(/from ['"]\.\.\/library\/IpcLibraryApi['"]/);
      expect(contents, file).not.toMatch(/from ['"]\.\.\/playlists\/IpcPlaylistApi['"]/);
    }
  });
});

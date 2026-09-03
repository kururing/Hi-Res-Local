import { describe, expect, it } from 'vitest';
import { MockAudioEngine } from '../audio/MockAudioEngine';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockRuntime, resetDefaultMockRuntime } from '../platform/mock/MockRuntime';
import { MOCK_PLAYLISTS } from '../services/mock';

describe('MockPlatform shared runtime', () => {
  it('mutates a playlist through the platform API and reads the same state back', async () => {
    const platform = createMockPlatform(new MockRuntime({ persist: false }));
    const created = await platform.playlists.create({ name: 'Evening Mix' });
    await platform.playlists.addTracks(created.id, ['track-1', 'track-2']);

    const details = await platform.playlists.get(created.id);
    expect(details.playlist.name).toBe('Evening Mix');
    expect(details.tracks.map(track => track.id)).toEqual(['track-1', 'track-2']);
    expect((await platform.playlists.list()).some(playlist => playlist.id === created.id)).toBe(true);
  });

  it('keeps favorite flags consistent across favorites and library', async () => {
    const platform = createMockPlatform(new MockRuntime({ persist: false }));
    const tracks = await platform.library.getAllTracks();
    const track = tracks[0];
    expect(track).toBeDefined();

    await platform.favorites.setTrackFavorite(track.id, true);
    const favoriteIds = new Set(
      (await platform.library.getAllTracks())
        .filter(item => item.is_favorite)
        .map(item => item.id)
    );
    expect(favoriteIds.has(track.id)).toBe(true);

    await platform.favorites.setAlbumFavorite('1÷x=1', 'Wanna One', true);
    await platform.favorites.setArtistFavorite('Wanna One', true);
    expect(await platform.favorites.getFavoriteAlbums()).toEqual([
      { album_title: '1÷x=1', artist_name: 'Wanna One' },
    ]);
    expect(await platform.favorites.getFavoriteArtists()).toEqual(['Wanna One']);
  });

  it('records history and lists the same entries with pagination', async () => {
    const platform = createMockPlatform(new MockRuntime({ persist: false }));
    await platform.history.record({
      track_id: 'track-1',
      completed_duration_ms: 183000,
      fully_played: true,
    });
    await platform.history.record({
      track_id: 'track-2',
      completed_duration_ms: 4000,
      fully_played: false,
    });

    const page = await platform.history.list({ limit: 1, offset: 0 });
    expect(page).toHaveLength(1);
    expect(page[0]?.track_id).toBe('track-2');
    expect(page[0]?.track?.id).toBe('track-2');

    const rest = await platform.history.list({ limit: 10, offset: 1 });
    expect(rest[0]?.track_id).toBe('track-1');
    expect(await platform.history.clear()).toBe(2);
    expect(await platform.history.list()).toEqual([]);
  });

  it('resets the default runtime back to fixture playlists', async () => {
    resetDefaultMockRuntime();
    const platform = createMockPlatform();
    await platform.playlists.create({ name: 'Transient Mix' });
    resetDefaultMockRuntime();

    const names = (await createMockPlatform().playlists.list()).map(playlist => playlist.name);
    expect(names).toEqual(MOCK_PLAYLISTS.map(playlist => playlist.name));
    expect(names).not.toContain('Transient Mix');
  });

  it('wires every mock domain API to the same store instance', async () => {
    const runtime = new MockRuntime({ persist: false });
    const platform = createMockPlatform(runtime);

    expect(platform.library).toBe(runtime.library);
    expect(platform.playlists).toBe(runtime.playlists);
    expect(platform.favorites).toBe(runtime.favorites);
    expect(platform.history).toBe(runtime.history);
    expect(platform.lyrics).toBe(runtime.lyrics);
    expect(platform.audioConfiguration).toBe(runtime.audioConfiguration);
    expect(platform.commands).toBe(runtime.commands);

    await platform.playlists.create({ name: 'Shared Mix' });
    expect((await runtime.playlists.list()).some(playlist => playlist.name === 'Shared Mix')).toBe(true);
  });

  it('keeps a single MockAudioEngine per platform and does not create a second via commands', async () => {
    const platform = createMockPlatform(new MockRuntime({ persist: false }));
    expect(platform.audioEngine).toBeInstanceOf(MockAudioEngine);
    expect(platform.audioEngine.queueOwnership).toBe('client');

    const before = await platform.audioEngine.getStatus();
    await platform.commands.invoke('play_track', {
      track: (await platform.library.getAllTracks())[0],
    });
    const after = await platform.audioEngine.getStatus();

    expect(before.state).toBe('stopped');
    expect(after.state).toBe('stopped');
    expect(after.current_track).toBeNull();
  });
});

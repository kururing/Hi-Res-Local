import { describe, expect, it } from 'vitest';
import { MOCK_AUDIO_CAPABILITIES } from '../platform/mock/MockAudioConfigurationApi';
import { MockRuntime } from '../platform/mock/MockRuntime';
import { MOCK_OUTPUT_DEVICES, MOCK_PLAYLISTS } from '../services/mock';

describe('direct Mock domain APIs', () => {
  it('creates, updates, reorders, and deletes playlists against shared tracks', async () => {
    const runtime = new MockRuntime({ persist: false });
    const created = await runtime.playlists.create({ name: 'Night Mix', description: 'Late' });
    expect(created.track_count).toBe(0);

    expect(await runtime.playlists.addTracks(created.id, ['track-2', 'track-1', 'track-2'])).toBe(2);
    await runtime.playlists.reorderTracks(created.id, ['track-1', 'track-2']);
    const details = await runtime.playlists.get(created.id);
    expect(details.tracks.map(track => track.id)).toEqual(['track-1', 'track-2']);

    const updated = await runtime.playlists.update({
      id: created.id,
      name: 'Dawn Mix',
      cover_art_path: 'data:image/png;base64,aaa',
    });
    expect(updated.name).toBe('Dawn Mix');
    expect(updated.cover_art_path).toBe('data:image/png;base64,aaa');
    expect(await runtime.playlists.removeTracks(created.id, ['track-2'])).toBe(1);
    expect(await runtime.playlists.delete(created.id)).toBe(true);
    await expect(runtime.playlists.get(created.id)).rejects.toThrow('Playlist not found');
    expect(await runtime.playlists.pickCover()).toBeNull();
    expect((await runtime.playlists.list()).map(playlist => playlist.name))
      .toEqual(MOCK_PLAYLISTS.map(playlist => playlist.name));
  });

  it('paginates history and omits retry tokens from stored entries', async () => {
    const runtime = new MockRuntime({ persist: false });
    await runtime.history.record({
      track_id: 'track-1',
      completed_duration_ms: 183000,
      fully_played: false,
      client_request_id: 'retry-1',
    });
    const listed = await runtime.history.list({ limit: 10, offset: 0 });
    expect(JSON.stringify(listed)).not.toMatch(/client_request_id/);
    expect(listed[0]?.completed_duration_ms).toBe(183000);
    expect(listed[0]?.track?.id).toBe('track-1');
  });

  it('reports the current mock audio devices and capabilities', async () => {
    const runtime = new MockRuntime({ persist: false });
    expect(await runtime.audioConfiguration.getOutputDevices()).toEqual(MOCK_OUTPUT_DEVICES);
    expect(await runtime.audioConfiguration.getCapabilities()).toEqual(MOCK_AUDIO_CAPABILITIES);
    expect(await runtime.audioConfiguration.getAsioDrivers()).toEqual([]);
    expect(await runtime.audioConfiguration.applyPlaybackMode({ mode: 'multitask' }))
      .toMatchObject({ output_mode: 'WASAPI Shared', backend: 'shared' });
    await runtime.audioConfiguration.setOutputDevice('default');
    await runtime.audioConfiguration.setEqualizer(true, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await runtime.audioConfiguration.setCrossfade(2);
    await runtime.audioConfiguration.setReplayGain({
      mode: 'track',
      preamp_db: 1,
      prevent_clipping: true,
    });
    const unsubscribe = await runtime.audioConfiguration.subscribeExclusiveMode(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('returns theme and artwork data URLs without filesystem paths', async () => {
    const runtime = new MockRuntime({ persist: false });
    const png = 'data:image/png;base64,aaa';
    expect(await runtime.themeAssets.cacheImage({
      cacheKey: 'theme-1',
      category: 'themes',
      dataUrl: png,
    })).toBe(png);
    expect(await runtime.artworkAssets.cacheRemoteArtwork('album:echo', png)).toBe(png);
    expect(await runtime.artworkAssets.resolveDisplaySource('C:/cover.jpg')).toBeNull();
    expect(await runtime.artworkAssets.getAppleMusicArtistArtwork('vn', 1)).toBeNull();
    await runtime.artworkAssets.clearRemoteArtworkCache();
  });

  it('exports an empty backup and treats presence as a no-op', async () => {
    const runtime = new MockRuntime({ persist: false });
    expect(await runtime.backup.exportDatabase()).toEqual([]);
    await runtime.backup.importDatabase([1, 2, 3]);
    await runtime.presence.setDiscordPresence(true, {
      title: 'Light',
      artist: 'Wanna One',
      position_secs: 0,
      duration_secs: 183,
    });
  });
});

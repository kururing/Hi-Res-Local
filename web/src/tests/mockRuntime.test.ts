import { describe, expect, it, vi } from 'vitest';
import { MockEventBus } from '../platform/mock/MockEventBus';
import { MockRuntime } from '../platform/mock/MockRuntime';
import { MOCK_PLAYLISTS, MOCK_TRACKS } from '../services/mock';

describe('MockDataStore fixtures', () => {
  it('clones fixture constants instead of mutating them', async () => {
    const runtime = new MockRuntime({ persist: false });
    const originalTitle = MOCK_TRACKS[0]?.title;
    const originalPlaylistName = MOCK_PLAYLISTS[0]?.name;
    const originalTrackCount = MOCK_TRACKS.length;

    const tracks = await runtime.library.getAllTracks();
    tracks[0].title = 'mutated-in-consumer';
    await runtime.favorites.setTrackFavorite(tracks[0].id, !(tracks[0].is_favorite ?? false));
    await runtime.playlists.create({ name: 'Temporary Mix' });

    expect(MOCK_TRACKS[0]?.title).toBe(originalTitle);
    expect(MOCK_TRACKS).toHaveLength(originalTrackCount);
    expect(MOCK_PLAYLISTS[0]?.name).toBe(originalPlaylistName);
    expect(MOCK_PLAYLISTS).toHaveLength(3);
  });

  it('resets state and listeners back to the fixture snapshot', async () => {
    const runtime = new MockRuntime({ persist: false, scanStepDelayMs: 0 });
    const listener = vi.fn();
    const unsubscribe = await runtime.library.subscribeScanProgress(listener);

    await runtime.playlists.create({ name: 'Scratch Mix' });
    await runtime.history.record({
      track_id: 'track-1',
      completed_duration_ms: 1000,
      fully_played: false,
    });
    await runtime.library.scanDirectory('D:/Music');
    expect(listener).toHaveBeenCalled();

    runtime.reset();
    listener.mockClear();
    await runtime.library.scanDirectory('D:/Music');
    expect(listener).not.toHaveBeenCalled();

    const listed = await runtime.playlists.list();
    expect(listed.some(playlist => playlist.name === 'Scratch Mix')).toBe(false);
    expect(listed).toHaveLength(MOCK_PLAYLISTS.length);
    expect(await runtime.history.list()).toEqual([]);
    expect(await runtime.autostart.isEnabled()).toBe(false);
    expect(await runtime.lyrics.getTrackLyrics('track-1')).not.toBeNull();
    await expect(runtime.lyrics.fetchRemoteLyrics({
      trackId: 'track-1',
      title: 'Nắng Ấm Xa Dần (Remastered)',
      artist: 'Sơn Tùng M-TP',
      album: 'Tuyển Tập Sơn Tùng',
      durationSeconds: 218,
    })).resolves.toBeNull();

    unsubscribe();
    unsubscribe();
  });
});

describe('MockEventBus', () => {
  it('subscribes, emits, and unsubscribes without keeping stale listeners', () => {
    const bus = new MockEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe<number>('library://scan_progress', listener);

    bus.emit('library://scan_progress', 1);
    unsubscribe();
    unsubscribe();
    bus.emit('library://scan_progress', 2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it('keeps other listeners running when one throws', () => {
    const bus = new MockEventBus();
    const exploding = vi.fn(() => {
      throw new Error('listener failed');
    });
    const surviving = vi.fn();
    bus.subscribe('library://scan_finished', exploding);
    bus.subscribe('library://scan_finished', surviving);

    expect(() => bus.emit('library://scan_finished', { total: 1, success: true })).not.toThrow();
    expect(exploding).toHaveBeenCalledTimes(1);
    expect(surviving).toHaveBeenCalledWith({ total: 1, success: true });
  });

  it('does not emit playback events from the mock command gateway', async () => {
    const runtime = new MockRuntime({ persist: false });
    const onEnded = vi.fn();
    await runtime.commands.listen('audio://track_ended', onEnded);

    await runtime.commands.invoke('play_track', {
      track: (await runtime.library.getAllTracks())[0],
    });
    await runtime.commands.invoke('next_track');

    expect(onEnded).not.toHaveBeenCalled();
  });
});

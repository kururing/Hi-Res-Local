import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAudioEngine } from '../audio/MockAudioEngine';
import type { Track } from '../types/library';

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Light',
    artist: 'Wanna One',
    album: '1÷x=1',
    duration: 2,
    path: 'preview://light',
    date_added: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('MockAudioEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a client-owned queue and does not pretend to be a browser streamer', () => {
    const engine = new MockAudioEngine();
    expect(engine.kind).toBe('mock');
    expect(engine.queueOwnership).toBe('client');
  });

  it('advances position while playing, pauses, resumes, and stops', async () => {
    const engine = new MockAudioEngine();
    const onPositionChange = vi.fn();
    engine.subscribe({ onPositionChange });

    await engine.playTrack(sampleTrack());
    vi.advanceTimersByTime(500);
    expect((await engine.getStatus()).position).toBe(0.5);
    expect((await engine.getStatus()).state).toBe('playing');

    await engine.pause();
    const pausedAt = (await engine.getStatus()).position;
    vi.advanceTimersByTime(500);
    expect((await engine.getStatus()).position).toBe(pausedAt);
    expect((await engine.getStatus()).state).toBe('paused');

    await engine.resume();
    vi.advanceTimersByTime(250);
    expect((await engine.getStatus()).position).toBe(pausedAt + 0.25);
    expect((await engine.getStatus()).state).toBe('playing');

    await engine.stop();
    expect((await engine.getStatus()).position).toBe(0);
    expect((await engine.getStatus()).state).toBe('stopped');
    vi.advanceTimersByTime(500);
    expect((await engine.getStatus()).position).toBe(0);
  });

  it('clamps seek to the track duration', async () => {
    const engine = new MockAudioEngine();
    await engine.playTrack(sampleTrack({ duration: 10 }));
    await engine.pause();

    await engine.seek(-4);
    expect((await engine.getStatus()).position).toBe(0);

    await engine.seek(99);
    expect((await engine.getStatus()).position).toBe(10);
  });

  it('emits track-ended only once when the timer reaches the duration', async () => {
    const engine = new MockAudioEngine();
    const onTrackEnded = vi.fn();
    engine.subscribe({ onTrackEnded });

    await engine.playTrack(sampleTrack({ duration: 0.5 }));
    vi.advanceTimersByTime(1000);
    expect(onTrackEnded).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(onTrackEnded).toHaveBeenCalledTimes(1);
  });

  it('loops a single track from the start instead of ending', async () => {
    const engine = new MockAudioEngine();
    const onTrackEnded = vi.fn();
    const onPositionChange = vi.fn();
    engine.subscribe({ onTrackEnded, onPositionChange });

    await engine.setLoopMode('track');
    await engine.playTrack(sampleTrack({ duration: 0.5 }));
    vi.advanceTimersByTime(500);

    expect(onTrackEnded).not.toHaveBeenCalled();
    expect((await engine.getStatus()).position).toBe(0);
    expect((await engine.getStatus()).state).toBe('playing');
  });

  it('stores volume and mute without opening an AudioContext', async () => {
    const engine = new MockAudioEngine();
    const audioContextSpy = vi.fn();
    vi.stubGlobal('AudioContext', audioContextSpy);

    await engine.setVolume(0.3);
    await engine.setMuted(true);
    const status = await engine.getStatus();
    const system = await engine.getSystemAudioState();

    expect(status.volume).toBe(0.3);
    expect(status.is_muted).toBe(true);
    expect(system).toEqual({ volume: 0.3, is_muted: true });
    expect(audioContextSpy).not.toHaveBeenCalled();
    await engine.playTrack(sampleTrack());
    expect(audioContextSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await engine.stop();
  });

  it('does not deliver events after unsubscribe', async () => {
    const engine = new MockAudioEngine();
    const onPositionChange = vi.fn();
    const unsubscribe = engine.subscribe({ onPositionChange });

    await engine.playTrack(sampleTrack());
    unsubscribe();
    onPositionChange.mockClear();
    vi.advanceTimersByTime(500);
    expect(onPositionChange).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('does not create overlapping timers when play is called repeatedly', async () => {
    const engine = new MockAudioEngine();
    const onPositionChange = vi.fn();
    engine.subscribe({ onPositionChange });

    await engine.playTrack(sampleTrack());
    await engine.playTrack(sampleTrack());
    onPositionChange.mockClear();
    vi.advanceTimersByTime(250);
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    await engine.stop();
  });

  it('keeps queue mutations as no-ops so the frontend queue stays authoritative', async () => {
    const engine = new MockAudioEngine();
    const onTrackChange = vi.fn();
    const onTrackEnded = vi.fn();
    engine.subscribe({ onTrackChange, onTrackEnded });

    await engine.replaceQueue([sampleTrack()], 0);
    await engine.setQueueIndex(1);
    await engine.addToQueue([sampleTrack({ id: 'track-2' })]);
    await engine.playNext(sampleTrack({ id: 'track-3' }));
    await engine.removeFromQueue(0);
    await engine.reorderQueue(0, 1);
    await engine.clearUpcoming();
    await engine.next();
    await engine.previous();

    expect(onTrackChange).not.toHaveBeenCalled();
    expect(onTrackEnded).not.toHaveBeenCalled();
    expect((await engine.getStatus()).current_track).toBeNull();
  });
});

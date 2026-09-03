import { describe, expect, it, vi } from 'vitest';
import { TauriAudioEngine } from '../audio/TauriAudioEngine';
import type { AudioEngineListener } from '../audio/contracts';
import { isExpectedPlaybackAbort } from '../audio/browserErrors';
import type { PlatformCommandGateway } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import type { StreamDescriptor } from '../platform/streaming/types';
import type { EngineStatus } from '../types/audio';
import type { Track } from '../types/library';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (payload: unknown) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Light',
    artist: 'Wanna One',
    album: '1÷x=1',
    duration: 183,
    path: 'D:/Music/Light.flac',
    date_added: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function sampleEngineStatus(overrides: Partial<EngineStatus> = {}): EngineStatus {
  return {
    output_mode: 'WASAPI Exclusive',
    bit_perfect: true,
    is_native: false,
    output_sample_rate: 48000,
    output_bit_depth: 24,
    source_label: 'Light',
    backend: 'wasapi_exclusive',
    dsd_output_mode: 'pcm',
    source_format: 'FLAC 24-bit / 96 kHz',
    source_sample_rate: 96000,
    source_bit_depth: 24,
    dsd_transport: null,
    output_format: 'PCM 24-bit / 48 kHz',
    volume: 1,
    volume_control_kind: 'windows_endpoint',
    fallback_reason: null,
    ...overrides,
  };
}

async function waitForListeners(
  listen: ReturnType<typeof vi.fn>,
  count = 10
): Promise<Map<string, (payload: unknown) => void>> {
  await vi.waitFor(() => expect(listen).toHaveBeenCalledTimes(count));
  const handlers = new Map<string, (payload: unknown) => void>();
  for (const [event, callback] of listen.mock.calls) {
    handlers.set(event as string, callback as (payload: unknown) => void);
  }
  return handlers;
}

describe('TauriAudioEngine', () => {
  it('owns the queue on the engine and maps every transport command', async () => {
    const { invoke, commands } = createGateway();
    const engine = new TauriAudioEngine(commands);
    const track = sampleTrack();
    const queue = [track, sampleTrack({ id: 'track-2' })];

    expect(engine.kind).toBe('tauri');
    expect(engine.queueOwnership).toBe('engine');

    invoke.mockResolvedValue(undefined);
    await engine.playTrack(track, 12);
    expect(invoke).toHaveBeenLastCalledWith('play_track', { track, startPositionSecs: 12 });

    await engine.playQueue(queue, 1, 3);
    expect(invoke).toHaveBeenLastCalledWith('play_queue', {
      tracks: queue,
      startIndex: 1,
      startPositionSecs: 3,
    });

    await engine.playCurrent();
    expect(invoke).toHaveBeenLastCalledWith('play_current');
    await engine.pause();
    expect(invoke).toHaveBeenLastCalledWith('pause_playback');
    await engine.resume();
    expect(invoke).toHaveBeenLastCalledWith('resume_playback');
    await engine.stop();
    expect(invoke).toHaveBeenLastCalledWith('stop_playback');
    await engine.next();
    expect(invoke).toHaveBeenLastCalledWith('next_track');
    await engine.previous();
    expect(invoke).toHaveBeenLastCalledWith('previous_track');
    await engine.seek(44);
    expect(invoke).toHaveBeenLastCalledWith('seek_playback', { positionSecs: 44 });
    await engine.setVolume(0.4);
    expect(invoke).toHaveBeenLastCalledWith('set_volume', { volume: 0.4 });
    await engine.setMuted(true);
    expect(invoke).toHaveBeenLastCalledWith('set_muted', { muted: true });
    await engine.setLoopMode('track');
    expect(invoke).toHaveBeenLastCalledWith('set_loop_mode', { mode: 'track' });
    await engine.setShuffle(false);
    expect(invoke).toHaveBeenLastCalledWith('set_shuffle', { shuffle: false });
    await engine.replaceQueue(queue, 1);
    expect(invoke).toHaveBeenLastCalledWith('queue_replace', { tracks: queue, currentIndex: 1 });
    await engine.setQueueIndex(1);
    expect(invoke).toHaveBeenLastCalledWith('queue_set_index', { index: 1 });
    await engine.addToQueue([track]);
    expect(invoke).toHaveBeenLastCalledWith('queue_add', { tracks: [track] });
    await engine.playNext(track);
    expect(invoke).toHaveBeenLastCalledWith('queue_play_next', { track });
    await engine.removeFromQueue(0);
    expect(invoke).toHaveBeenLastCalledWith('queue_remove', { index: 0 });
    await engine.reorderQueue(0, 1);
    expect(invoke).toHaveBeenLastCalledWith('queue_reorder', { from: 0, to: 1 });
    await engine.clearUpcoming();
    expect(invoke).toHaveBeenLastCalledWith('queue_clear_upcoming');

    invoke.mockResolvedValueOnce({ state: 'stopped' });
    await engine.getStatus();
    expect(invoke).toHaveBeenLastCalledWith('get_playback_status', {});

    invoke.mockResolvedValueOnce({ track_id: 'track-1', position_ms: 12000 });
    await expect(engine.getSavedPlaybackState()).resolves.toEqual({
      track_id: 'track-1',
      position_ms: 12000,
    });
    expect(invoke).toHaveBeenLastCalledWith('get_saved_playback_state', {});

    invoke.mockResolvedValueOnce({ volume: 0.5, is_muted: true });
    await expect(engine.getSystemAudioState()).resolves.toEqual({ volume: 0.5, is_muted: true });
    expect(invoke).toHaveBeenLastCalledWith('get_system_audio_state', {});
  });

  it('maps IPC payloads onto the engine listener contract', async () => {
    const { listen, commands } = createGateway();
    listen.mockResolvedValue(vi.fn());
    const engine = new TauriAudioEngine(commands);
    const listener: AudioEngineListener = {
      onPositionChange: vi.fn(),
      onStateChange: vi.fn(),
      onTrackChange: vi.fn(),
      onTrackEnded: vi.fn(),
      onEngineStatus: vi.fn(),
      onExclusiveMode: vi.fn(),
      onNativeDsdStatus: vi.fn(),
      onError: vi.fn(),
      onDeviceLost: vi.fn(),
      onVolumeChange: vi.fn(),
    };

    engine.subscribe(listener);
    const handlers = await waitForListeners(listen);
    const track = sampleTrack();
    const status = sampleEngineStatus();

    handlers.get('audio://position')?.({ position_secs: 12.5, duration_secs: 183 });
    expect(listener.onPositionChange).toHaveBeenCalledWith(12.5, 183);

    handlers.get('audio://state_changed')?.({ state: 'paused' });
    expect(listener.onStateChange).toHaveBeenCalledWith('paused');

    handlers.get('audio://track_changed')?.(track);
    expect(listener.onTrackChange).toHaveBeenCalledWith(track);

    handlers.get('audio://track_ended')?.({});
    expect(listener.onTrackEnded).toHaveBeenCalledTimes(1);

    handlers.get('audio://engine_status')?.(status);
    expect(listener.onEngineStatus).toHaveBeenCalledWith(status);

    handlers.get('audio://exclusive_mode')?.({
      enabled: true,
      output_mode: 'WASAPI Exclusive',
      error: null,
    });
    expect(listener.onExclusiveMode).toHaveBeenCalledWith({
      enabled: true,
      outputMode: 'WASAPI Exclusive',
      error: null,
    });

    handlers.get('audio://native_dsd_status')?.({
      active: true,
      dsd_rate: 'dsd256',
      error: null,
    });
    expect(listener.onNativeDsdStatus).toHaveBeenCalledWith({
      active: true,
      dsdRate: 'dsd256',
      error: null,
    });

    handlers.get('audio://error')?.({ message: 'Decoder failed' });
    expect(listener.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Decoder failed' }));

    handlers.get('audio://device_lost')?.({ error: 'Device unplugged' });
    expect(listener.onDeviceLost).toHaveBeenCalledWith('Device unplugged');

    handlers.get('audio://volume_changed')?.({ volume: 0.2, is_muted: true });
    expect(listener.onVolumeChange).toHaveBeenCalledWith({ volume: 0.2, isMuted: true });
  });

  it('does not leak when disposed before async listeners resolve', async () => {
    const { listen, commands } = createGateway();
    const unlistens = Array.from({ length: 10 }, () => vi.fn());
    const resolvers: Array<(unlisten: () => void) => void> = [];
    listen.mockImplementation(
      () => new Promise<() => void>(resolve => {
        resolvers.push(resolve);
      })
    );

    const engine = new TauriAudioEngine(commands);
    const unsubscribe = engine.subscribe({});
    unsubscribe();

    await vi.waitFor(() => expect(resolvers).toHaveLength(10));
    resolvers.forEach((resolve, index) => resolve(unlistens[index]));
    await vi.waitFor(() => {
      for (const unlisten of unlistens) {
        expect(unlisten).toHaveBeenCalledTimes(1);
      }
    });
  });

  it('continues cleaning up remaining listeners when one unlisten throws', async () => {
    const { listen, commands } = createGateway();
    const unlistens = Array.from({ length: 10 }, (_, index) =>
      vi.fn(() => {
        if (index === 0) throw new Error('unlisten failed');
      })
    );
    let next = 0;
    listen.mockImplementation(async () => unlistens[next++]);

    const engine = new TauriAudioEngine(commands);
    const unsubscribe = engine.subscribe({});
    await vi.waitFor(() => expect(listen).toHaveBeenCalledTimes(10));
    await Promise.resolve();

    expect(() => unsubscribe()).not.toThrow();
    for (const unlisten of unlistens) {
      expect(unlisten).toHaveBeenCalledTimes(1);
    }
  });

  it('does not request a stream for local filesystem tracks', async () => {
    const { invoke, commands } = createGateway();
    const createStream = vi.fn();
    const engine = new TauriAudioEngine(commands, { streaming: { createStream } });
    invoke.mockResolvedValue(undefined);
    const track = sampleTrack();
    await engine.playTrack(track, 12);
    expect(createStream).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenLastCalledWith('play_track', { track, startPositionSecs: 12 });
  });

  it('strips a stale web stream URL from merged local DSD tracks', async () => {
    const { invoke, commands } = createGateway();
    const createStream = vi.fn();
    const engine = new TauriAudioEngine(commands, { streaming: { createStream } });
    invoke.mockResolvedValue(undefined);
    const track = sampleTrack({
      id: 'local-dsd-1',
      path: 'D:/Music/Album/Track01.dsf',
      source: 'local_and_cloud',
      cloudTrackId: '11111111-1111-4111-8111-111111111111',
    }) as Track & { stream_url?: string; stream_expires_at?: string };
    track.stream_url = 'https://music.example/Track01.dsf?signature=stale';
    track.stream_expires_at = new Date(Date.now() + 120_000).toISOString();

    await engine.playTrack(track);

    expect(createStream).not.toHaveBeenCalled();
    const payload = invoke.mock.calls.at(-1)?.[1] as {
      track: Track & { stream_url?: string; stream_expires_at?: string };
    };
    expect(payload.track.path).toBe('D:/Music/Album/Track01.dsf');
    expect(payload.track.stream_url).toBeUndefined();
    expect(payload.track.stream_expires_at).toBeUndefined();
  });

  it('resolves a signed URL for cloud tracks without stuffing it into path', async () => {
    const { invoke, commands } = createGateway();
    const createStream = vi.fn(async () => ({
      url: 'https://127.0.0.1:9000/bucket/a.flac?X-Amz-Signature=secret',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      asset: {
        codec: 'flac',
        container: 'flac',
        sampleRateHz: 96_000,
        bitDepth: 24,
        channels: 2,
        bitrateKbps: null,
        lossless: true,
      },
    }));
    const engine = new TauriAudioEngine(commands, {
      streaming: { createStream },
      getQuality: () => 'max',
    });
    invoke.mockResolvedValue(undefined);
    const track = sampleTrack({
      id: '11111111-1111-4111-8111-111111111111',
      path: '',
      source: 'cloud',
      cloudTrackId: '11111111-1111-4111-8111-111111111111',
    });
    await engine.playTrack(track);
    expect(createStream).toHaveBeenCalledWith(track.cloudTrackId, {
      quality: 'max',
      supportedFormats: [],
    }, expect.any(AbortSignal));
    const payload = invoke.mock.calls.at(-1)?.[1] as {
      track: { path: string; stream_url?: string };
    };
    expect(payload.track.path).toBe('');
    expect(payload.track.stream_url).toBe(
      'https://127.0.0.1:9000/bucket/a.flac?X-Amz-Signature=secret'
    );
  });

  it('does not dispatch a stale cloud track when songs are switched rapidly', async () => {
    const { invoke, commands } = createGateway();
    const pending = new Map<string, (descriptor: StreamDescriptor) => void>();
    const signals = new Map<string, AbortSignal | undefined>();
    const createStream = vi.fn((id: string, _request, signal?: AbortSignal) => {
      signals.set(id, signal);
      return new Promise<StreamDescriptor>(resolve => pending.set(id, resolve));
    });
    const engine = new TauriAudioEngine(commands, { streaming: { createStream } });
    invoke.mockResolvedValue(undefined);
    const first = sampleTrack({
      id: '11111111-1111-4111-8111-111111111111',
      path: '',
      source: 'cloud',
      cloudTrackId: '11111111-1111-4111-8111-111111111111',
    });
    const second = sampleTrack({
      id: '22222222-2222-4222-8222-222222222222',
      path: '',
      source: 'cloud',
      cloudTrackId: '22222222-2222-4222-8222-222222222222',
    });
    const descriptor = (id: string): StreamDescriptor => ({
      url: `https://127.0.0.1:9000/bucket/${id}.flac?X-Amz-Signature=secret`,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      asset: {
        codec: 'flac',
        container: 'flac',
        sampleRateHz: 96_000,
        bitDepth: 24,
        channels: 2,
        bitrateKbps: null,
        lossless: true,
      },
    });

    const firstPlay = engine.playTrack(first);
    await vi.waitFor(() => expect(pending.has(first.id)).toBe(true));
    const secondPlay = engine.playTrack(second);
    await vi.waitFor(() => expect(pending.has(second.id)).toBe(true));
    expect(signals.get(first.id)?.aborted).toBe(true);

    pending.get(second.id)?.(descriptor(second.id));
    await secondPlay;
    pending.get(first.id)?.(descriptor(first.id));
    await expect(firstPlay).rejects.toSatisfy(isExpectedPlaybackAbort);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({
      track: expect.objectContaining({ id: second.id }),
    }));
  });

  it('ignores stale decoder events while a newly clicked cloud track is resolving', async () => {
    const { invoke, listen, commands } = createGateway();
    listen.mockResolvedValue(vi.fn());
    let resolveStream!: (descriptor: StreamDescriptor) => void;
    const createStream = vi.fn(() => new Promise<StreamDescriptor>(resolve => {
      resolveStream = resolve;
    }));
    const engine = new TauriAudioEngine(commands, { streaming: { createStream } });
    invoke.mockResolvedValue(undefined);
    const onError = vi.fn();
    const onStateChange = vi.fn();
    const onTrackChange = vi.fn();
    engine.subscribe({ onError, onStateChange, onTrackChange });
    const handlers = await waitForListeners(listen);
    const target = sampleTrack({
      id: '22222222-2222-4222-8222-222222222222',
      path: '',
      source: 'cloud',
      cloudTrackId: '22222222-2222-4222-8222-222222222222',
    });

    const play = engine.playTrack(target);
    await vi.waitFor(() => expect(createStream).toHaveBeenCalledTimes(1));
    handlers.get('audio://error')?.({ message: 'Audio format unsupported for path old.flac' });
    handlers.get('audio://state_changed')?.({ state: 'stopped' });
    handlers.get('audio://track_changed')?.(sampleTrack({ id: 'old-track' }));
    expect(onError).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onTrackChange).not.toHaveBeenCalled();

    resolveStream({
      url: 'https://127.0.0.1:9000/bucket/new.flac?X-Amz-Signature=secret',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      asset: {
        codec: 'flac',
        container: 'flac',
        sampleRateHz: 96_000,
        bitDepth: 24,
        channels: 2,
        bitrateKbps: null,
        lossless: true,
      },
    });
    await play;
    handlers.get('audio://error')?.({ message: 'real current error' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'real current error' }));
  });

  it('refreshes an unresolved cloud queue item before jumping to it', async () => {
    const { invoke, commands } = createGateway();
    const createStream = vi.fn(async (id: string) => ({
      url: `https://127.0.0.1:9000/bucket/${id}.flac?X-Amz-Signature=secret`,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      asset: {
        codec: 'flac',
        container: 'flac',
        sampleRateHz: 96_000,
        bitDepth: 24,
        channels: 2,
        bitrateKbps: null,
        lossless: true,
      },
    }));
    const engine = new TauriAudioEngine(commands, { streaming: { createStream } });
    invoke.mockResolvedValue(undefined);
    const tracks = ['1', '2', '3'].map(suffix => sampleTrack({
      id: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
      path: '',
      source: 'cloud',
      cloudTrackId: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
    }));

    await engine.playQueue(tracks, 0);
    expect(createStream).toHaveBeenCalledTimes(2);
    invoke.mockClear();
    createStream.mockClear();

    await engine.setQueueIndex(2);

    expect(createStream).toHaveBeenCalledWith(
      tracks[2].id,
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(invoke.mock.calls[0]).toEqual([
      'refresh_stream_url',
      expect.objectContaining({ trackId: tracks[2].id, restartCurrent: false }),
    ]);
    expect(invoke.mock.calls[1]).toEqual(['queue_set_index', { index: 2 }]);
  });

  it('renews a cloud stream URL after a 403 and asks the backend to recover the current decoder', async () => {
    const { invoke, listen, commands } = createGateway();
    listen.mockResolvedValue(vi.fn());
    const createStream = vi.fn(async () => ({
      url: `https://127.0.0.1:9000/bucket/a.flac?X-Amz-Signature=${createStream.mock.calls.length}`,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      asset: {
        codec: 'flac',
        container: 'flac',
        sampleRateHz: 96_000,
        bitDepth: 24,
        channels: 2,
        bitrateKbps: null,
        lossless: true,
      },
    }));
    const engine = new TauriAudioEngine(commands, { streaming: { createStream } });
    invoke.mockResolvedValue(undefined);
    const onError = vi.fn();
    engine.subscribe({ onError });
    const handlers = await waitForListeners(listen);
    const track = sampleTrack({
      id: '11111111-1111-4111-8111-111111111111',
      path: '',
      source: 'cloud',
      cloudTrackId: '11111111-1111-4111-8111-111111111111',
    });
    await engine.playTrack(track);
    createStream.mockClear();
    invoke.mockClear();
    handlers.get('audio://error')?.({ message: 'Server returned 403 Forbidden (access denied)' });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('refresh_stream_url', expect.objectContaining({
        trackId: track.id,
        restartCurrent: true,
      }));
    });
    expect(createStream).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('platform wiring', () => {
  it('exposes a Tauri engine with engine-owned queue', () => {
    const tauri = createTauriPlatform();
    expect(tauri.audioEngine).toBeInstanceOf(TauriAudioEngine);
    expect(tauri.audioEngine.kind).toBe('tauri');
    expect(tauri.audioEngine.queueOwnership).toBe('engine');
    expect(createMockPlatform().audioEngine.queueOwnership).toBe('client');
    expect(createWebPlatform('/api').audioEngine.queueOwnership).toBe('client');
  });
});

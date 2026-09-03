import { describe, expect, it, vi } from 'vitest';
import { BrowserAudioEngine } from '../audio/BrowserAudioEngine';
import { PlaybackError } from '../audio/browserErrors';
import type { StreamDescriptor, StreamingApi } from '../platform/streaming/types';
import type { Track } from '../types/library';
import { createFakePcmHarness } from './support/fakePcmSession';

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-a',
    title: 'Lanterns',
    artist: 'Aurora Circuit',
    album: 'Glass Harbor',
    duration: 180,
    path: '',
    date_added: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

function descriptor(overrides: Partial<StreamDescriptor> = {}): StreamDescriptor {
  return {
    url: 'https://storage.example.test/a.wav?sig=a',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    asset: {
      codec: 'pcm',
      container: 'wav',
      mimeType: 'audio/wav',
      sampleRateHz: 44_100,
      bitDepth: 16,
      channels: 2,
      bitrateKbps: 1411,
      lossless: true,
    },
    ...overrides,
  };
}

function streaming(impl?: Partial<StreamingApi> | ((trackId: string) => Promise<StreamDescriptor>)): StreamingApi {
  const createStream = typeof impl === 'function'
    ? impl
    : impl?.createStream ?? (async (trackId: string) => descriptor({
      url: `https://storage.example.test/${trackId}.wav?sig=1`,
    }));
  return { createStream };
}

function engine(options: {
  streaming?: StreamingApi;
  quality?: 'auto' | 'high' | 'lossless' | 'max';
  now?: () => number;
  autoReady?: boolean;
} = {}) {
  const pcm = createFakePcmHarness();
  const audio = new BrowserAudioEngine({
    streaming: options.streaming ?? streaming(),
    getQuality: () => options.quality ?? 'auto',
    now: options.now,
    createPcmSession: handlers => {
      const session = pcm.createSession(handlers);
      if (options.autoReady === false) session.autoReady = false;
      return session;
    },
  });
  return { audio, pcm };
}

describe('BrowserAudioEngine', () => {
  it('is a browser engine with a client-owned queue', () => {
    const { audio } = engine();
    expect(audio.kind).toBe('browser');
    expect(audio.queueOwnership).toBe('client');
  });

  it('plays a track through loading then playing', async () => {
    const { audio, pcm } = engine();
    const states: string[] = [];
    const engineStatuses: string[] = [];
    audio.subscribe({
      onStateChange: state => states.push(state),
      onEngineStatus: status => engineStatuses.push(status.output_mode),
    });

    await audio.playTrack(sampleTrack());
    expect(states).toEqual(['loading', 'playing']);
    expect(pcm.session.url).toContain('track-a.wav');
    expect((await audio.getStatus()).state).toBe('playing');
    expect(engineStatuses.at(-1)).toBe('nnpm-audio-core');
  });

  it('requests the original MinIO source without probing browser codecs', async () => {
    const createStream = vi.fn(async () => descriptor());
    const { audio } = engine({ streaming: { createStream } });
    await audio.playTrack(sampleTrack());
    expect(createStream).toHaveBeenCalledWith(
      'track-a',
      { quality: 'auto', supportedFormats: [] },
      expect.any(AbortSignal),
    );
  });

  it('pauses, resumes, stops, seeks, and reports duration', async () => {
    const { audio, pcm } = engine();
    await audio.playTrack(sampleTrack({ duration: 120 }));
    await audio.pause();
    expect((await audio.getStatus()).state).toBe('paused');

    await audio.resume();
    expect((await audio.getStatus()).state).toBe('playing');

    pcm.session.setPosition(12);
    expect((await audio.getStatus()).position).toBe(12);
    expect((await audio.getStatus()).duration).toBe(120);

    await audio.seek(40);
    expect(pcm.session.getPosition()).toBe(40);

    await audio.stop();
    expect((await audio.getStatus()).state).toBe('stopped');
    expect((await audio.getStatus()).position).toBe(0);
    expect(pcm.session.url).toBe('');
  });

  it('stores a pending seek until the session is created', async () => {
    let resolveStream: ((value: StreamDescriptor) => void) | undefined;
    const createStream = vi.fn(() => new Promise<StreamDescriptor>(resolve => {
      resolveStream = resolve;
    }));
    const { audio, pcm } = engine({ streaming: { createStream } });
    const play = audio.playTrack(sampleTrack(), 25);
    await vi.waitFor(() => expect(createStream).toHaveBeenCalled());
    await audio.seek(33);
    resolveStream?.(descriptor());
    await play;
    expect(pcm.session.getPosition()).toBe(33);
  });

  it('emits volume only when the value changes and clamps input', async () => {
    const { audio } = engine();
    const volumes: Array<{ volume: number; isMuted: boolean }> = [];
    audio.subscribe({ onVolumeChange: status => volumes.push(status) });

    await audio.setVolume(0.4);
    await audio.setVolume(0.4);
    await audio.setMuted(true);
    await audio.setMuted(true);

    expect(volumes).toEqual([
      { volume: 0.4, isMuted: false },
      { volume: 0.4, isMuted: true },
    ]);
  });

  it('normalizes autoplay rejection without retrying play forever', async () => {
    const { audio, pcm } = engine({ autoReady: false });
    const errors: Error[] = [];
    audio.subscribe({ onError: error => errors.push(error) });
    const play = audio.playTrack(sampleTrack());
    await vi.waitFor(() => expect(pcm.sessionOrNull).not.toBeNull());
    pcm.session.playError = Object.assign(new Error('play blocked'), { name: 'NotAllowedError' });
    pcm.session.ready();
    await expect(play).rejects.toBeInstanceOf(PlaybackError);
    expect(errors[0]).toMatchObject({ code: 'AUTOPLAY_BLOCKED' });
  });

  it('ignores a stale descriptor from track A after switching to B', async () => {
    let resolveA: ((value: StreamDescriptor) => void) | undefined;
    const createStream = vi.fn(async (trackId: string) => {
      if (trackId === 'track-a') {
        return new Promise<StreamDescriptor>(resolve => {
          resolveA = resolve;
        });
      }
      return descriptor({ url: 'https://storage.example.test/b.wav?sig=b' });
    });
    const { audio, pcm } = engine({ streaming: { createStream } });

    const playA = audio.playTrack(sampleTrack({ id: 'track-a' }));
    await audio.playTrack(sampleTrack({ id: 'track-b' }));
    resolveA?.(descriptor({ url: 'https://storage.example.test/a.wav?sig=stale' }));
    await playA.catch(() => undefined);

    expect(pcm.session.url).toBe('https://storage.example.test/b.wav?sig=b');
    expect(pcm.session.url).not.toContain('stale');
  });

  it('ignores late events from a previous source', async () => {
    const { audio, pcm } = engine();
    const states: string[] = [];
    audio.subscribe({ onStateChange: state => states.push(state) });
    await audio.playTrack(sampleTrack({ id: 'track-a' }));
    const first = pcm.session;
    await audio.playTrack(sampleTrack({ id: 'track-b' }));
    const afterSwitch = states.length;
    first.fail();
    first.finish();
    expect(states.slice(afterSwitch)).toEqual([]);
  });

  it('routes DSF through core PCM at a valid AudioContext sample rate', async () => {
    const { audio, pcm } = engine({
      streaming: streaming(async () => descriptor({
        asset: {
          codec: 'dsd',
          container: 'dsf',
          mimeType: 'audio/dsf',
          sampleRateHz: 2_822_400,
          bitDepth: 1,
          channels: 2,
          bitrateKbps: 5_644,
          lossless: true,
          isDsd: true,
          dsdRate: 64,
        },
      })),
    });

    await audio.playTrack(sampleTrack({ format: 'DSF' }));

    expect(pcm.session.outputSampleRate).toBe(176_400);
    expect((await audio.getStatus()).state).toBe('playing');
  });

  it('emits only the first actionable error for one playback attempt', async () => {
    const { audio, pcm } = engine();
    const errors: Error[] = [];
    audio.subscribe({ onError: error => errors.push(error) });
    await audio.playTrack(sampleTrack());

    pcm.session.fail(new PlaybackError('DECODE', 'decode failed'));
    pcm.session.fail(new PlaybackError('PLAYBACK', 'generic playback failure'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'DECODE' });
  });

  it('emits ended only once and does not also fire onTrackEnded', async () => {
    const { audio, pcm } = engine();
    const ended = vi.fn();
    const trackEnded = vi.fn();
    audio.subscribe({ onStateChange: state => { if (state === 'ended') ended(); }, onTrackEnded: trackEnded });
    await audio.playTrack(sampleTrack());
    pcm.session.finish();
    pcm.session.finish();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(trackEnded).not.toHaveBeenCalled();
  });

  it('keeps queue methods as no-ops', async () => {
    const { audio } = engine();
    const changed = vi.fn();
    audio.subscribe({ onTrackChange: changed });
    await audio.replaceQueue([sampleTrack()], 0);
    await audio.setQueueIndex(1);
    await audio.addToQueue([sampleTrack({ id: 'x' })]);
    await audio.playNext(sampleTrack({ id: 'y' }));
    await audio.removeFromQueue(0);
    await audio.reorderQueue(0, 1);
    await audio.clearUpcoming();
    await audio.next();
    await audio.previous();
    expect(changed).not.toHaveBeenCalled();
    expect((await audio.getStatus()).current_track).toBeNull();
  });

  it('aborts the in-flight request on stop and switch', async () => {
    const signals: AbortSignal[] = [];
    const createStream = vi.fn((_id: string, _request, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<StreamDescriptor>(() => undefined);
    });
    const { audio } = engine({ streaming: { createStream } });
    void audio.playTrack(sampleTrack({ id: 'track-a' }));
    await Promise.resolve();
    void audio.playTrack(sampleTrack({ id: 'track-b' }));
    await Promise.resolve();
    await audio.stop();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('does not renew a fetched core source on resume or seek', async () => {
    let now = Date.now();
    const createStream = vi.fn(async (trackId: string) => descriptor({
      url: `https://storage.example.test/${trackId}-${createStream.mock.calls.length}.wav`,
      expiresAt: new Date(now + 1_000).toISOString(),
    }));
    const { audio, pcm } = engine({
      streaming: { createStream },
      now: () => now,
    });
    const trackChanges = vi.fn();
    audio.subscribe({ onTrackChange: trackChanges });

    await audio.playTrack(sampleTrack());
    expect(trackChanges).toHaveBeenCalledTimes(1);
    pcm.session.setPosition(17);
    await audio.pause();

    now += 20_000;
    await audio.resume();
    expect(createStream).toHaveBeenCalledTimes(1);
    expect(trackChanges).toHaveBeenCalledTimes(1);
    expect(pcm.session.getPosition()).toBe(17);

    now += 20_000;
    await audio.seek(22);
    expect(createStream).toHaveBeenCalledTimes(1);
    expect(trackChanges).toHaveBeenCalledTimes(1);
    expect(pcm.session.getPosition()).toBe(22);
  });

  it('renews once after an expiry-adjacent decode error and does not retry forever', async () => {
    let now = Date.now();
    const createStream = vi.fn(async () => descriptor({
      expiresAt: new Date(now + 500).toISOString(),
    }));
    const { audio, pcm } = engine({
      streaming: { createStream },
      now: () => now,
    });
    await audio.playTrack(sampleTrack());
    now += 20_000;
    pcm.session.fail();
    await Promise.resolve();
    await Promise.resolve();
    expect(createStream).toHaveBeenCalledTimes(2);
    pcm.session.fail();
    await Promise.resolve();
    expect(createStream).toHaveBeenCalledTimes(2);
  });

  it('cleans up listeners on dispose', async () => {
    const { audio, pcm } = engine();
    const ended = vi.fn();
    audio.subscribe({ onStateChange: state => { if (state === 'ended') ended(); } });
    await audio.playTrack(sampleTrack());
    const session = pcm.session;
    audio.dispose();
    session.finish();
    expect(ended).not.toHaveBeenCalled();
  });
});

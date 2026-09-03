/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudioEngine } from '../audio/BrowserAudioEngine';
import { PlayerProvider, usePlayer } from '../context/PlayerContext';
import { SettingsProvider } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { AuthProvider } from '../context/AuthContext';
import { LibraryProvider } from '../context/LibraryContext';
import { PlatformProvider } from '../platform';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockRuntime } from '../platform/mock/MockRuntime';
import type { StreamDescriptor, StreamingApi } from '../platform/streaming/types';
import type { Track } from '../types/library';
import { createFakePcmHarness } from './support/fakePcmSession';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

function sampleTrack(id: string, title = id): Track {
  return {
    id,
    title,
    artist: 'Aurora Circuit',
    album: 'Glass Harbor',
    duration: 30,
    path: '',
    date_added: '2026-08-29T00:00:00.000Z',
  };
}

function descriptor(trackId: string): StreamDescriptor {
  return {
    url: `https://storage.example.test/${trackId}.wav?sig=1`,
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
  };
}

function mountPlayer(engine: BrowserAudioEngine, historyRecord: HistoryApiRecord) {
  const base = createMockPlatform(new MockRuntime({ persist: false }));
  const platform = {
    ...base,
    runtime: 'web' as const,
    capabilities: { ...base.capabilities, remotePlayback: true },
    audioEngine: engine,
    history: {
      ...base.history,
      record: historyRecord,
    },
  };

  let api: ReturnType<typeof usePlayer> | null = null;
  const Probe = () => {
    api = usePlayer();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PlatformProvider platform={platform}>
        <ToastProvider>
          <SettingsProvider>
            <AuthProvider>
            <LibraryProvider>
              <PlayerProvider>
                <Probe />
              </PlayerProvider>
            </LibraryProvider>
            </AuthProvider>
          </SettingsProvider>
        </ToastProvider>
      </PlatformProvider>
    );
  });

  return {
    get player() {
      if (!api) throw new Error('Player hook was not mounted.');
      return api;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

type HistoryApiRecord = (input: {
  track_id: string;
  completed_duration_ms: number;
  fully_played: boolean;
}) => Promise<{
  id: number;
  track_id: string;
  played_at: string;
  completed_duration_ms: number;
  fully_played: boolean;
  track: Track | null;
}>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PlayerContext browser playback', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('auto-advances once, loops a track, and records history once per play', async () => {
    const pcm = createFakePcmHarness();
    const createStream = vi.fn(async (trackId: string) => descriptor(trackId));
    const streaming: StreamingApi = { createStream };
    const engine = new BrowserAudioEngine({
      streaming,
      createPcmSession: pcm.createSession,
      getQuality: () => 'auto',
    });
    let historyId = 0;
    const historyRecord = vi.fn<HistoryApiRecord>(async input => ({
      id: ++historyId,
      track_id: input.track_id,
      played_at: new Date().toISOString(),
      completed_duration_ms: input.completed_duration_ms,
      fully_played: input.fully_played,
      track: null,
    }));
    const mounted = mountPlayer(engine, historyRecord);
    await flush();
    const first = sampleTrack('track-1', 'One');
    const second = sampleTrack('track-2', 'Two');

    await act(async () => {
      await mounted.player.playQueue([first, second], 0);
    });
    await flush();
    expect((await engine.getStatus()).state).toBe('playing');
    expect(mounted.player.status.state).toBe('playing');
    expect(mounted.player.status.current_track?.id).toBe('track-1');
    expect(mounted.player.status.current_track?.format).toBe('WAV');

    await act(async () => {
      pcm.session.finish();
    });
    await flush();
    expect(createStream.mock.calls.filter(call => call[0] === 'track-2')).toHaveLength(1);
    expect(mounted.player.status.current_track?.id).toBe('track-2');
    expect(historyRecord.mock.calls.some(call => call[0].track_id === 'track-1' && call[0].fully_played)).toBe(true);

    await act(async () => {
      await mounted.player.setLoopMode('track');
    });
    const historyBeforeLoop = historyRecord.mock.calls.length;
    await act(async () => {
      pcm.session.finish();
    });
    await flush();
    expect(mounted.player.status.current_track?.id).toBe('track-2');
    expect(createStream.mock.calls.filter(call => call[0] === 'track-2').length).toBeGreaterThan(1);
    expect(historyRecord.mock.calls.length).toBeGreaterThan(historyBeforeLoop);

    const renewCalls = createStream.mock.calls.length;
    await act(async () => {
      await engine.seek(5);
    });
    expect(createStream.mock.calls.length).toBe(renewCalls);

    mounted.unmount();
    expect((await engine.getStatus()).state).toBe('stopped');
  });

  it('keeps shuffle on the client queue and surfaces loading then error', async () => {
    const streaming: StreamingApi = {
      createStream: async () => {
        throw Object.assign(new Error('The requested stream quality is not available'), {
          name: 'PlaybackError',
        });
      },
    };
    const engine = new BrowserAudioEngine({
      streaming,
      getQuality: () => 'lossless',
    });
    const historyRecord = vi.fn<HistoryApiRecord>(async input => ({
      id: 1,
      track_id: input.track_id,
      played_at: new Date().toISOString(),
      completed_duration_ms: input.completed_duration_ms,
      fully_played: input.fully_played,
      track: null,
    }));
    const mounted = mountPlayer(engine, historyRecord);
    const tracks = [sampleTrack('a'), sampleTrack('b'), sampleTrack('c')];

    await act(async () => {
      await mounted.player.toggleShuffle();
      await mounted.player.playQueue(tracks, 0);
    });
    expect(mounted.player.status.shuffle).toBe(true);
    expect(mounted.player.queue[0]?.id).toBe('a');
    expect(mounted.player.status.state).toBe('paused');

    mounted.unmount();
  });
});

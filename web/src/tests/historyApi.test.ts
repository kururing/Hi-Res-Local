import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CloudApiClient } from '../api/client';
import type { PlatformCommandGateway } from '../platform/contracts';
import { TauriHistoryApi } from '../platform/history/IpcHistoryApi';
import { MockHistoryApi } from '../platform/mock/MockHistoryApi';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebHistoryApi } from '../platform/web/WebHistoryApi';
import { AccountBoundHistoryApi } from '../platform/hybrid/AccountBoundApis';
import type { PlayHistoryEntry } from '../types/ipc';
import type { Track } from '../types/library';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function createCloudClient(request: CloudApiClient['request']): CloudApiClient {
  return { request } as CloudApiClient;
}

function sampleTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Light',
    artist: 'Wanna One',
    album: '1÷x=1',
    duration: 183,
    path: '',
    date_added: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

function sampleEntry(overrides: Partial<PlayHistoryEntry> = {}): PlayHistoryEntry {
  return {
    id: 1,
    track_id: 'track-1',
    track: sampleTrack(),
    played_at: '2026-08-24T00:00:00.000Z',
    completed_duration_ms: 183500,
    fully_played: false,
    ...overrides,
  };
}

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('TauriHistoryApi', () => {
  it('passes pagination parameters through unchanged', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriHistoryApi(commands);

    invoke.mockResolvedValueOnce([]);
    await api.list({ limit: 50, offset: 25 });
    expect(invoke).toHaveBeenLastCalledWith('get_play_history', { limit: 50, offset: 25 });
  });

  it('records completed duration in milliseconds and omits retry tokens from IPC', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriHistoryApi(commands);
    const entry = sampleEntry();

    invoke.mockResolvedValueOnce(entry);
    await api.record({
      track_id: 'track-1',
      completed_duration_ms: 183500,
      fully_played: false,
      client_request_id: 'retry-1',
    });
    expect(invoke).toHaveBeenLastCalledWith('record_play', {
      input: {
        track_id: 'track-1',
        completed_duration_ms: 183500,
        fully_played: false,
      },
    });
    expect(JSON.stringify(invoke.mock.calls[0])).not.toMatch(/client_request_id/);
  });

  it('returns the number of cleared history rows', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriHistoryApi(commands);

    invoke.mockResolvedValueOnce(7);
    await expect(api.clear()).resolves.toBe(7);
    expect(invoke).toHaveBeenLastCalledWith('clear_play_history');
  });

  it('does not record a play when history is listed after remount', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriHistoryApi(commands);

    invoke.mockResolvedValue([]);
    await api.list({ limit: 100, offset: 0 });
    await api.list({ limit: 100, offset: 0 });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_play_history', { limit: 100, offset: 0 });
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_play_history', { limit: 100, offset: 0 });
    expect(invoke.mock.calls.some(call => call[0] === 'record_play')).toBe(false);
  });
});

describe('platform wiring', () => {
  it('exposes the matching history adapter on each runtime', () => {
    expect(createTauriPlatform().history).toBeInstanceOf(TauriHistoryApi);
    expect(createMockPlatform().history).toBeInstanceOf(MockHistoryApi);
    expect(createWebPlatform('/api').history).toBeInstanceOf(WebHistoryApi);
  });

  it('uses the cloud history API on signed-in desktop', () => {
    const platform = createTauriPlatform({
      cloud: createCloudClient(vi.fn()),
      isAuthenticated: () => true,
    });
    expect(platform.history).toBeInstanceOf(AccountBoundHistoryApi);
  });
});

describe('WebHistoryApi', () => {
  it('sends pagination, millisecond duration, and clear count through the cloud API', async () => {
    const request = vi.fn();
    const api = new WebHistoryApi(createCloudClient(request));
    const entry = sampleEntry({
      track: sampleTrack({
        path: 'https://cdn.example.test/tracks/light.flac',
        cover_art_path: 'https://cdn.example.test/covers/light.jpg',
      }),
    });

    request.mockResolvedValueOnce([entry]);
    await expect(api.list({ limit: 50, offset: 25 })).resolves.toEqual([entry]);
    expect(request).toHaveBeenLastCalledWith('/v1/history?limit=50&offset=25');

    request.mockResolvedValueOnce(entry);
    await api.record({
      track_id: 'track-1',
      completed_duration_ms: 183500,
      fully_played: true,
      client_request_id: 'retry-1',
    });
    expect(request).toHaveBeenLastCalledWith('/v1/history', {
      method: 'POST',
      headers: expect.any(Headers),
      body: {
        track_id: 'track-1',
        completed_duration_ms: 183500,
        fully_played: true,
        client_request_id: 'retry-1',
      },
    });
    const recordOptions = request.mock.calls[1]?.[1] as { headers: Headers };
    expect(recordOptions.headers.get('Idempotency-Key')).toBe('retry-1');

    request.mockResolvedValueOnce(4);
    await expect(api.clear()).resolves.toBe(4);
    expect(request).toHaveBeenLastCalledWith('/v1/history', { method: 'DELETE' });
  });

  it('does not expose local filesystem paths from cloud history payloads', async () => {
    const request = vi.fn();
    const api = new WebHistoryApi(createCloudClient(request));

    request.mockResolvedValueOnce([
      sampleEntry({
        track: sampleTrack({
          path: 'D:/Music/V-Pop/Light.flac',
          cover_art_path: 'C:/cache/light.jpg',
        }),
      }),
    ]);

    const entries = await api.list({ limit: 10, offset: 0 });
    expect(entries[0]?.track?.path).toBe('');
    expect(entries[0]?.track?.cover_art_path).toBeNull();
    expect(JSON.stringify(entries)).not.toMatch(/D:\/Music/);
    expect(JSON.stringify(entries)).not.toMatch(/C:\/cache/);
  });
});

describe('history consumers', () => {
  it('no longer import IpcService for history list or clear', () => {
    expect(source('../components/views/HistoryView.tsx')).not.toMatch(/IpcService/);
    expect(source('../context/PlayerContext.tsx')).not.toMatch(/IpcService/);
    expect(source('../context/PlayerContext.tsx')).toMatch(/history\.record\(/);
  });
});

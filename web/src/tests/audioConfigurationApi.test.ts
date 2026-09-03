import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TauriAudioConfigurationApi } from '../platform/audio/IpcAudioConfigurationApi';
import { MockAudioConfigurationApi } from '../platform/mock/MockAudioConfigurationApi';
import type { PlatformCommandGateway } from '../platform/contracts';
import { PlatformUnsupportedError } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import {
  WEB_AUDIO_CAPABILITIES,
  WebAudioConfigurationApi,
} from '../platform/web/WebAudioConfigurationApi';
import type { AudioCapabilities, EngineStatus } from '../types/audio';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function sampleCapabilities(overrides: Partial<AudioCapabilities> = {}): AudioCapabilities {
  return {
    exclusive_mode_supported: true,
    media_controls_supported: true,
    gapless_supported: true,
    replay_gain_supported: true,
    equalizer_supported: true,
    asio_supported: true,
    native_dsd_supported: true,
    dsd_rates: ['dsd64'],
    dop_supported: true,
    dop_rates: ['dsd64'],
    asio_drivers_present: true,
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
    source_label: '',
    backend: 'wasapi_exclusive',
    dsd_output_mode: 'pcm',
    source_format: '',
    source_sample_rate: 0,
    source_bit_depth: 0,
    dsd_transport: null,
    output_format: 'PCM 24-bit / 48 kHz',
    volume: 1,
    volume_control_kind: 'windows_endpoint',
    fallback_reason: null,
    ...overrides,
  };
}

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('TauriAudioConfigurationApi', () => {
  it('invokes the matching IPC command and arguments', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriAudioConfigurationApi(commands);

    invoke.mockResolvedValueOnce([]);
    await api.getOutputDevices();
    expect(invoke).toHaveBeenLastCalledWith('get_audio_output_devices');

    invoke.mockResolvedValueOnce(sampleCapabilities());
    await api.getCapabilities();
    expect(invoke).toHaveBeenLastCalledWith('get_audio_capabilities');

    invoke.mockResolvedValueOnce([]);
    await api.getAsioDrivers();
    expect(invoke).toHaveBeenLastCalledWith('get_asio_drivers');

    invoke.mockResolvedValueOnce(undefined);
    await api.setOutputDevice('endpoint-1');
    expect(invoke).toHaveBeenLastCalledWith('set_audio_output_device', { deviceId: 'endpoint-1' });

    invoke.mockResolvedValueOnce(sampleEngineStatus());
    await api.applyPlaybackMode({
      mode: 'advanced',
      deviceId: 'default',
      backend: 'asio',
      dsdTransport: 'native_dsd',
      asioDriverId: 'driver-1',
    });
    expect(invoke).toHaveBeenLastCalledWith('apply_playback_mode', {
      mode: 'advanced',
      deviceId: 'default',
      backend: 'asio',
      dsdTransport: 'native_dsd',
      asioDriverId: 'driver-1',
    });

    invoke.mockResolvedValueOnce(undefined);
    await api.setEqualizer(true, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(invoke).toHaveBeenLastCalledWith('set_equalizer', {
      enabled: true,
      gains: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });

    invoke.mockResolvedValueOnce(undefined);
    await api.setCrossfade(4);
    expect(invoke).toHaveBeenLastCalledWith('set_crossfade', { duration_secs: 4 });

    invoke.mockResolvedValueOnce(undefined);
    await api.setReplayGain({ mode: 'track', preamp_db: 2, prevent_clipping: true });
    expect(invoke).toHaveBeenLastCalledWith('set_replay_gain', {
      mode: 'track',
      preamp_db: 2,
      prevent_clipping: true,
    });
  });

  it('returns an unsubscribe function from the exclusive-mode listener', async () => {
    const { listen, commands } = createGateway();
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    const api = new TauriAudioConfigurationApi(commands);
    const onExclusive = vi.fn();

    const unsubscribe = await api.subscribeExclusiveMode(onExclusive);

    expect(listen).toHaveBeenCalledWith('audio://exclusive_mode', onExclusive);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe('platform wiring', () => {
  it('exposes the matching audio configuration adapter on each runtime', () => {
    expect(createTauriPlatform().audioConfiguration).toBeInstanceOf(TauriAudioConfigurationApi);
    expect(createMockPlatform().audioConfiguration).toBeInstanceOf(MockAudioConfigurationApi);
    expect(createWebPlatform('/api').audioConfiguration).toBeInstanceOf(WebAudioConfigurationApi);
  });
});

describe('WebAudioConfigurationApi', () => {
  it('does not advertise ASIO, DSD, or exclusive hardware', async () => {
    const api = new WebAudioConfigurationApi();
    const capabilities = await api.getCapabilities();

    expect(capabilities).toEqual(WEB_AUDIO_CAPABILITIES);
    expect(capabilities.asio_supported).toBe(false);
    expect(capabilities.native_dsd_supported).toBe(false);
    expect(capabilities.exclusive_mode_supported).toBe(false);
    expect(capabilities.dop_supported).toBe(false);
    expect(capabilities.asio_drivers_present).toBe(false);
    expect(await api.getOutputDevices()).toEqual([]);
    expect(await api.getAsioDrivers()).toEqual([]);
  });

  it('rejects native configuration instead of returning a fake engine status', async () => {
    const api = new WebAudioConfigurationApi();

    await expect(api.setOutputDevice('default')).resolves.toBeUndefined();
    await expect(api.setEqualizer(true, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
      .rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.setCrossfade(2)).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.setReplayGain({ mode: 'off', preamp_db: 0, prevent_clipping: true }))
      .rejects.toBeInstanceOf(PlatformUnsupportedError);

    await expect(api.applyPlaybackMode({ mode: 'multitask', deviceId: 'default' }))
      .rejects.toBeInstanceOf(PlatformUnsupportedError);

    try {
      await api.applyPlaybackMode({ mode: 'high_quality' });
      expect.fail('web applyPlaybackMode must not return a native engine status');
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformUnsupportedError);
      expect(JSON.stringify(error)).not.toMatch(/WASAPI Shared/);
    }
  });

  it('returns a no-op exclusive listener without opening a native subscription', async () => {
    const api = new WebAudioConfigurationApi();
    const unsubscribe = await api.subscribeExclusiveMode(() => undefined);

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('audio configuration consumers', () => {
  it('no longer import IpcService for audio configuration', () => {
    const files = [
      '../context/SettingsContext.tsx',
      '../components/views/SettingsView.tsx',
      '../components/player/PlayerBar.tsx',
      '../components/player/EqualizerModal.tsx',
    ];
    for (const file of files) {
      expect(source(file), file).not.toMatch(/IpcService/);
      expect(source(file), file).not.toMatch(/isTauri/);
    }
  });

  it('exposes MQA passthrough in the quick audio popup', () => {
    const playerBar = source('../components/player/PlayerBar.tsx');

    expect(playerBar).toMatch(/MQA Passthrough/);
    expect(playerBar).toMatch(/changeMqaPassthrough/);
    expect(playerBar).toMatch(/mqa_passthrough: enabled/);
  });

});

import type { AsioDriver, AudioCapabilities, AudioOutputDevice, EngineStatus } from '../../types/audio';
import type {
  ApplyPlaybackModeInput,
  AudioConfigurationApi,
  ExclusiveModeEvent,
  ReplayGainInput,
} from '../contracts';
import type { MockDataStore } from './MockDataStore';
import type { MockEventBus } from './MockEventBus';

export const MOCK_AUDIO_CAPABILITIES: AudioCapabilities = {
  exclusive_mode_supported: false,
  media_controls_supported: false,
  gapless_supported: true,
  replay_gain_supported: true,
  equalizer_supported: true,
  asio_supported: false,
  native_dsd_supported: false,
  dsd_rates: [],
  dop_supported: false,
  dop_rates: [],
  asio_drivers_present: false,
};

const MOCK_ENGINE_STATUS: EngineStatus = {
  output_mode: 'WASAPI Shared',
  bit_perfect: false,
  is_native: false,
  output_sample_rate: 48000,
  output_bit_depth: 32,
  source_label: '',
  backend: 'shared',
  dsd_output_mode: 'pcm',
  source_format: '',
  source_sample_rate: 0,
  source_bit_depth: 0,
  dsd_transport: null,
  output_format: 'PCM float 32-bit / 48 kHz',
  volume: 1,
  volume_control_kind: 'software',
  fallback_reason: null,
};

/**
 * Mock audio device/capability adapter. DSP mutations are no-ops because the
 * preview timer engine has no AudioContext graph.
 */
export class MockAudioConfigurationApi implements AudioConfigurationApi {
  constructor(
    private readonly store: MockDataStore,
    private readonly events: MockEventBus,
  ) {}

  getOutputDevices(): Promise<AudioOutputDevice[]> {
    return Promise.resolve(this.store.getOutputDevices());
  }

  getCapabilities(): Promise<AudioCapabilities> {
    return Promise.resolve({ ...MOCK_AUDIO_CAPABILITIES });
  }

  getAsioDrivers(): Promise<AsioDriver[]> {
    return Promise.resolve([]);
  }

  setOutputDevice(_deviceId: string): Promise<void> {
    return Promise.resolve();
  }

  applyPlaybackMode(_input: ApplyPlaybackModeInput): Promise<EngineStatus | null> {
    return Promise.resolve({ ...MOCK_ENGINE_STATUS });
  }

  setEqualizer(_enabled: boolean, _gains: number[]): Promise<void> {
    return Promise.resolve();
  }

  setCrossfade(_durationSeconds: number): Promise<void> {
    return Promise.resolve();
  }

  setReplayGain(_input: ReplayGainInput): Promise<void> {
    return Promise.resolve();
  }

  async subscribeExclusiveMode(
    callback: (event: ExclusiveModeEvent) => void
  ): Promise<() => void> {
    return this.events.subscribe('audio://exclusive_mode', callback);
  }
}

import type { AsioDriver, AudioCapabilities, AudioOutputDevice, EngineStatus } from '../../types/audio';
import type {
  ApplyPlaybackModeInput,
  AudioConfigurationApi,
  ExclusiveModeEvent,
  ReplayGainInput,
} from '../contracts';
import { PlatformUnsupportedError } from '../contracts';
import { WebAudioOutput } from '../../audio/WebAudioOutput';

export const WEB_AUDIO_CAPABILITIES: AudioCapabilities = {
  exclusive_mode_supported: false,
  media_controls_supported: false,
  gapless_supported: false,
  replay_gain_supported: false,
  equalizer_supported: false,
  asio_supported: false,
  native_dsd_supported: false,
  dsd_rates: [],
  dop_supported: false,
  dop_rates: [],
  asio_drivers_present: false,
};

/**
 * Browser cloud runtime. No WASAPI, ASIO, Native DSD, DoP, or DSP engine is
 * available in this round, so native configuration is rejected rather than
 * simulated with a desktop engine status.
 */
export class WebAudioConfigurationApi implements AudioConfigurationApi {
  constructor(private readonly output = new WebAudioOutput()) {}

  getOutputDevices(): Promise<AudioOutputDevice[]> {
    return this.output.getDevices();
  }

  requestOutputDevice(): Promise<AudioOutputDevice | null> {
    return this.output.requestDevice();
  }

  getCapabilities(): Promise<AudioCapabilities> {
    return Promise.resolve({ ...WEB_AUDIO_CAPABILITIES });
  }

  getAsioDrivers(): Promise<AsioDriver[]> {
    return Promise.resolve([]);
  }

  setOutputDevice(deviceId: string): Promise<void> {
    return this.output.setDevice(deviceId);
  }

  applyPlaybackMode(_input: ApplyPlaybackModeInput): Promise<EngineStatus | null> {
    return Promise.reject(new PlatformUnsupportedError('web', 'applyPlaybackMode'));
  }

  setEqualizer(_enabled: boolean, _gains: number[]): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'setEqualizer'));
  }

  setCrossfade(_durationSeconds: number): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'setCrossfade'));
  }

  setReplayGain(_input: ReplayGainInput): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'setReplayGain'));
  }

  async subscribeExclusiveMode(
    _callback: (event: ExclusiveModeEvent) => void
  ): Promise<() => void> {
    return () => undefined;
  }
}

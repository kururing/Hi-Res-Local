import type { AsioDriver, AudioCapabilities, AudioOutputDevice, EngineStatus } from '../../types/audio';
import type {
  ApplyPlaybackModeInput,
  AudioConfigurationApi,
  ExclusiveModeEvent,
  PlatformCommandGateway,
  ReplayGainInput,
} from '../contracts';

/** IPC-backed audio configuration adapter for the Tauri desktop runtime. */
export class IpcAudioConfigurationApi implements AudioConfigurationApi {
  constructor(protected readonly commands: PlatformCommandGateway) {}

  getOutputDevices(): Promise<AudioOutputDevice[]> {
    return this.commands.invoke('get_audio_output_devices');
  }

  getCapabilities(): Promise<AudioCapabilities> {
    return this.commands.invoke('get_audio_capabilities');
  }

  getAsioDrivers(): Promise<AsioDriver[]> {
    return this.commands.invoke('get_asio_drivers');
  }

  setOutputDevice(deviceId: string): Promise<void> {
    return this.commands.invoke('set_audio_output_device', { deviceId });
  }

  applyPlaybackMode(input: ApplyPlaybackModeInput): Promise<EngineStatus | null> {
    return this.commands.invoke('apply_playback_mode', {
      mode: input.mode,
      deviceId: input.deviceId,
      backend: input.backend,
      dsdTransport: input.dsdTransport,
      asioDriverId: input.asioDriverId,
      mqaPassthrough: input.mqaPassthrough,
    });
  }

  setEqualizer(enabled: boolean, gains: number[]): Promise<void> {
    return this.commands.invoke('set_equalizer', { enabled, gains });
  }

  setCrossfade(durationSeconds: number): Promise<void> {
    return this.commands.invoke('set_crossfade', { duration_secs: durationSeconds });
  }

  setReplayGain(input: ReplayGainInput): Promise<void> {
    return this.commands.invoke('set_replay_gain', {
      mode: input.mode,
      preamp_db: input.preamp_db,
      prevent_clipping: input.prevent_clipping,
    });
  }

  subscribeExclusiveMode(
    callback: (event: ExclusiveModeEvent) => void
  ): Promise<() => void> {
    return this.commands.listen('audio://exclusive_mode', callback);
  }

  getAudioTomlPatch() {
    return this.commands.invoke('get_audio_toml_patch');
  }
}

export class TauriAudioConfigurationApi extends IpcAudioConfigurationApi {}

import type { AudioOutputDevice } from '../types/audio';

type SinkCapableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type OutputCapableMediaDevices = MediaDevices & {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
};

function browserSinkId(deviceId: string): string {
  return deviceId === 'default' ? '' : deviceId;
}

/** Keeps the selected browser output in sync with every live AudioContext. */
export class WebAudioOutput {
  private selectedDeviceId = 'default';
  private readonly contexts = new Set<SinkCapableAudioContext>();

  async getDevices(): Promise<AudioOutputDevice[]> {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return [];
    const devices = await mediaDevices.enumerateDevices();
    let unnamedIndex = 0;
    return devices
      .filter(device => device.kind === 'audiooutput')
      .map(device => ({
        id: device.deviceId || 'default',
        name: device.label || `Audio output ${++unnamedIndex}`,
        is_default: device.deviceId === 'default',
      }));
  }

  async requestDevice(): Promise<AudioOutputDevice | null> {
    const mediaDevices = globalThis.navigator?.mediaDevices as OutputCapableMediaDevices | undefined;
    if (!mediaDevices?.selectAudioOutput) return null;
    const device = await mediaDevices.selectAudioOutput();
    return {
      id: device.deviceId,
      name: device.label || 'Audio output',
      is_default: device.deviceId === 'default',
    };
  }

  async setDevice(deviceId: string): Promise<void> {
    const previous = this.selectedDeviceId;
    this.selectedDeviceId = deviceId || 'default';
    try {
      await Promise.all([...this.contexts].map(context => this.apply(context)));
    } catch (error) {
      this.selectedDeviceId = previous;
      throw error;
    }
  }

  async register(context: AudioContext): Promise<() => void> {
    const sinkContext = context as SinkCapableAudioContext;
    await this.apply(sinkContext);
    this.contexts.add(sinkContext);
    return () => this.contexts.delete(sinkContext);
  }

  private async apply(context: SinkCapableAudioContext): Promise<void> {
    if (typeof context.setSinkId === 'function') {
      await context.setSinkId(browserSinkId(this.selectedDeviceId));
      return;
    }
    if (this.selectedDeviceId !== 'default') {
      throw new DOMException('Audio output selection is not supported by this browser.', 'NotSupportedError');
    }
  }
}

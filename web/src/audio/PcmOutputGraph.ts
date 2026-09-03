import { PCM_RING_WORKLET_NAME, PCM_RING_WORKLET_SOURCE } from './pcmRingWorklet';
import { clampMediaVolume } from './browserMedia';
import type { WebAudioOutput } from './WebAudioOutput';

/** Own a copy so transferring the buffer to the AudioWorklet cannot detach decoder memory. */
export function transferablePcmFrames(frames: Float32Array): Float32Array {
  return frames.slice();
}

export class PcmOutputGraph {
  private context: AudioContext;
  private node: AudioWorkletNode;
  private gain: GainNode;
  private unregisterOutput: (() => void) | null;

  private constructor(context: AudioContext, node: AudioWorkletNode, gain: GainNode, unregisterOutput: (() => void) | null) {
    this.context = context;
    this.node = node;
    this.gain = gain;
    this.unregisterOutput = unregisterOutput;
  }

  static async create(sampleRate: number, channels: number, output?: WebAudioOutput): Promise<PcmOutputGraph> {
    const context = new AudioContext({ sampleRate });
    const unregisterOutput = output ? await output.register(context) : null;
    const blob = new Blob([PCM_RING_WORKLET_SOURCE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await context.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    const node = new AudioWorkletNode(context, PCM_RING_WORKLET_NAME, {
      outputChannelCount: [Math.max(1, channels)],
    });
    const gain = context.createGain();
    node.connect(gain);
    gain.connect(context.destination);
    return new PcmOutputGraph(context, node, gain, unregisterOutput);
  }

  get audioContext(): AudioContext {
    return this.context;
  }

  setVolume(volume: number, muted: boolean): void {
    this.gain.gain.value = muted ? 0 : clampMediaVolume(volume);
  }

  pushPcm(frames: Float32Array, channels: number): void {
    const owned = transferablePcmFrames(frames);
    this.node.port.postMessage({ type: 'pcm', frames: owned, channels }, [owned.buffer]);
  }

  flush(): void {
    this.node.port.postMessage({ type: 'flush' });
  }

  async close(): Promise<void> {
    this.flush();
    this.node.disconnect();
    this.gain.disconnect();
    this.unregisterOutput?.();
    this.unregisterOutput = null;
    await this.context.close().catch(() => undefined);
  }
}

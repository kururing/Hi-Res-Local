import { ProbeError, type AudioProbe, type ProbedAudioMetadata } from './probe.js';
import { emptyMappedTags, type MappedAudioTags } from './tags.js';

export type FakeProbeInput = Partial<Omit<ProbedAudioMetadata, 'tags'>> & {
  tags?: Partial<MappedAudioTags>;
};

export function fakeProbedAudio(input: FakeProbeInput = {}): ProbedAudioMetadata {
  const { tags, ...rest } = input;
  return {
    container: 'flac',
    codec: 'flac',
    durationSeconds: 180,
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 2,
    channelLayout: 'stereo',
    bitrateKbps: 900,
    isLossless: true,
    hiRes: false,
    dsd: false,
    dsdRate: null,
    hasAudioStream: true,
    hasAttachedPicture: false,
    ...rest,
    tags: { ...emptyMappedTags(), ...tags },
  };
}

export class FakeAudioProbe implements AudioProbe {
  next: ProbedAudioMetadata | ProbeError | null = null;
  inspectPath: string | null = null;

  constructor(private readonly fallback?: FakeProbeInput) {}

  async inspect(path: string): Promise<ProbedAudioMetadata> {
    this.inspectPath = path;
    if (this.next instanceof ProbeError) throw this.next;
    if (this.next) return this.next;
    return fakeProbedAudio(this.fallback);
  }
}

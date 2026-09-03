import { FakeAudioProbe } from './fakeProbe.js';
import { NnpmProbeAudioProbe, NNPM_PROBE_MISSING, assertNnpmProbeAvailable } from './nnpmProbe.js';
import { ProbeError, type AudioProbe } from './probe.js';

export type MediaProbeMode = 'nnpm' | 'fake';

export interface ProbeSelectionConfig {
  nodeEnv: string;
  mediaProbeMode: MediaProbeMode;
  nnpmProbePath: string;
  nnpmProbeStartupTimeoutMs: number;
}

/**
 * Fake probe is allowed only when both MEDIA_PROBE_MODE=fake and NODE_ENV=test.
 * Missing nnpm-probe never falls back to fake.
 */
export function resolveMediaProbeMode(nodeEnv: string, requested: string): MediaProbeMode {
  const mode = requested.trim().toLowerCase();
  if (mode === 'fake') {
    if (nodeEnv !== 'test') {
      throw new ProbeError(
        NNPM_PROBE_MISSING,
        'MEDIA_PROBE_MODE=fake is only allowed when NODE_ENV=test.',
      );
    }
    return 'fake';
  }
  if (mode === 'nnpm' || mode === '') {
    return 'nnpm';
  }
  throw new ProbeError(NNPM_PROBE_MISSING, `Unsupported MEDIA_PROBE_MODE "${requested}".`);
}

export async function createAudioProbe(config: ProbeSelectionConfig): Promise<AudioProbe> {
  const mode = resolveMediaProbeMode(config.nodeEnv, config.mediaProbeMode);
  if (mode === 'fake') {
    return new FakeAudioProbe();
  }
  await assertNnpmProbeAvailable(config.nnpmProbePath, config.nnpmProbeStartupTimeoutMs);
  return new NnpmProbeAudioProbe(config.nnpmProbePath);
}

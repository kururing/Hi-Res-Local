import { describe, expect, it } from 'vitest';
import { createAudioProbe } from '../../src/ingestion/selectProbe.js';

describe('worker once fail-closed startup', () => {
  it('exits the probe factory with NNPM_PROBE_MISSING instead of claiming work', async () => {
    await expect(createAudioProbe({
      nodeEnv: 'production',
      mediaProbeMode: 'nnpm',
      nnpmProbePath: process.platform === 'win32' ? 'C:\\missing\\nnpm-probe.exe' : '/missing/nnpm-probe',
      nnpmProbeStartupTimeoutMs: 500,
    })).rejects.toMatchObject({ code: 'NNPM_PROBE_MISSING' });
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/config/env.js';
import { NnpmProbeAudioProbe, assertNnpmProbeAvailable } from '../../src/ingestion/nnpmProbe.js';
import { createAudioProbe } from '../../src/ingestion/selectProbe.js';
import { createSyntheticWav } from '../../src/media/synthetic.js';
import { nnpmProbeRequired, setGate } from './flags.js';

const config = testConfig({ mediaProbeMode: 'nnpm' });
let ready = false;
let reason = 'nnpm-probe was not checked.';
const tempDirs: string[] = [];

try {
  await assertNnpmProbeAvailable(config.nnpmProbePath, config.nnpmProbeStartupTimeoutMs);
  ready = true;
  setGate('nnpmProbe', 'PASS');
} catch (error) {
  reason = error instanceof Error ? error.message : String(error);
  if (nnpmProbeRequired()) {
    setGate('nnpmProbe', 'FAIL');
    throw new Error(reason);
  }
  setGate('nnpmProbe', 'SKIP');
}

const describeProbe = ready ? describe : describe.skip;

describeProbe('nnpm-probe live integration', () => {
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('probes a synthetic WAV with the real executable', async () => {
    const probe = await createAudioProbe({
      nodeEnv: 'test',
      mediaProbeMode: 'nnpm',
      nnpmProbePath: config.nnpmProbePath,
      nnpmProbeStartupTimeoutMs: config.nnpmProbeStartupTimeoutMs,
    });
    expect(probe).toBeInstanceOf(NnpmProbeAudioProbe);
    const wav = createSyntheticWav();
    const dir = await mkdtemp(path.join(tmpdir(), 'nnpm-probe-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'tone.wav');
    await writeFile(file, wav.body);
    const probed = await probe.inspect(file);
    expect(probed.container).toBe('wav');
    expect(probed.codec).toBe('pcm');
    expect(probed.sampleRateHz).toBe(wav.sampleRateHz);
    expect(probed.channels).toBe(wav.channels);
    expect(probed.bitDepth).toBe(wav.bitDepth);
    expect(Math.abs(probed.durationSeconds - wav.durationSeconds)).toBeLessThanOrEqual(wav.durationToleranceSeconds);
  });
});

if (!ready) {
  describe('nnpm-probe live integration (skipped)', () => {
    it('documents why nnpm-probe tests did not run', () => {
      if (nnpmProbeRequired()) throw new Error(reason);
      expect(reason).toBeTruthy();
    });
  });
}

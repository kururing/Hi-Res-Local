import { describe, expect, it } from 'vitest';
import { FakeAudioProbe } from '../../src/ingestion/fakeProbe.js';
import { NnpmProbeAudioProbe } from '../../src/ingestion/nnpmProbe.js';
import { ProbeError } from '../../src/ingestion/probe.js';
import { isNnpmProbeVersionOutput } from '../../src/ingestion/nnpmProbe.js';
import { createAudioProbe, resolveMediaProbeMode } from '../../src/ingestion/selectProbe.js';

describe('media probe selection', () => {
  it('allows fake only when NODE_ENV=test and MEDIA_PROBE_MODE=fake', () => {
    expect(resolveMediaProbeMode('test', 'fake')).toBe('fake');
    expect(() => resolveMediaProbeMode('production', 'fake')).toThrow(ProbeError);
    expect(() => resolveMediaProbeMode('development', 'fake')).toThrow(/NODE_ENV=test/);
    expect(resolveMediaProbeMode('production', 'nnpm')).toBe('nnpm');
  });

  it('creates a fake probe in explicit test mode', async () => {
    const probe = await createAudioProbe({
      nodeEnv: 'test',
      mediaProbeMode: 'fake',
      nnpmProbePath: 'nnpm-probe-does-not-exist-for-this-test',
      nnpmProbeStartupTimeoutMs: 500,
    });
    expect(probe).toBeInstanceOf(FakeAudioProbe);
  });

  it('fails closed in production when nnpm-probe is missing and does not fall back to fake', async () => {
    await expect(createAudioProbe({
      nodeEnv: 'production',
      mediaProbeMode: 'nnpm',
      nnpmProbePath: pathThatDoesNotExist(),
      nnpmProbeStartupTimeoutMs: 800,
    })).rejects.toMatchObject({ code: 'NNPM_PROBE_MISSING' });
  });

  it('rejects unrelated version banners', () => {
    expect(isNnpmProbeVersionOutput('nnpm-probe 0.1.0')).toBe(true);
    expect(isNnpmProbeVersionOutput('unrelated-probe 9.0.1')).toBe(false);
  });

  it('does not auto-select fake when the executable is missing', async () => {
    const result = createAudioProbe({
      nodeEnv: 'test',
      mediaProbeMode: 'nnpm',
      nnpmProbePath: pathThatDoesNotExist(),
      nnpmProbeStartupTimeoutMs: 800,
    });
    await expect(result).rejects.toMatchObject({ code: 'NNPM_PROBE_MISSING' });
    await expect(result.catch((error) => error)).resolves.not.toBeInstanceOf(FakeAudioProbe);
    expect(NnpmProbeAudioProbe).toBeTruthy();
  });
});

function pathThatDoesNotExist(): string {
  return process.platform === 'win32'
    ? 'C:\\nnpm-missing\\nnpm-probe-not-installed.exe'
    : '/usr/local/nnpm-missing/nnpm-probe-not-installed';
}

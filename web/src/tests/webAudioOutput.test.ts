import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioOutput } from '../audio/WebAudioOutput';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebAudioOutput', () => {
  it('enumerates only browser audio outputs', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
          { kind: 'audiooutput', deviceId: 'default', label: 'System default' },
          { kind: 'audiooutput', deviceId: 'dac-1', label: 'USB DAC' },
        ]),
      },
    });
    const output = new WebAudioOutput();

    await expect(output.getDevices()).resolves.toEqual([
      { id: 'default', name: 'System default', is_default: true },
      { id: 'dac-1', name: 'USB DAC', is_default: false },
    ]);
  });

  it('applies the selected sink to live and newly registered contexts', async () => {
    const firstSetSinkId = vi.fn(async () => undefined);
    const secondSetSinkId = vi.fn(async () => undefined);
    const first = { setSinkId: firstSetSinkId } as unknown as AudioContext;
    const second = { setSinkId: secondSetSinkId } as unknown as AudioContext;
    const output = new WebAudioOutput();

    const unregister = await output.register(first);
    await output.setDevice('dac-1');
    await output.register(second);

    expect(firstSetSinkId).toHaveBeenNthCalledWith(1, '');
    expect(firstSetSinkId).toHaveBeenLastCalledWith('dac-1');
    expect(secondSetSinkId).toHaveBeenCalledWith('dac-1');
    unregister();
    await output.setDevice('dac-2');
    expect(firstSetSinkId).not.toHaveBeenCalledWith('dac-2');
  });
});

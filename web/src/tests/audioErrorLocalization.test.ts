import { describe, expect, it } from 'vitest';
import { localizeAudioError } from '../i18n';

describe('audio error localization', () => {
  it('localizes a DoP rate rejection in Vietnamese', () => {
    expect(
      localizeAudioError(
        'Format not supported by DAC (DoP): DSD256 is not available as DoP on this device',
        'vi',
      ),
    ).toBe('DSD256 không thể phát qua DoP trên thiết bị này.');
  });

  it('uses the selected English wording', () => {
    expect(
      localizeAudioError(
        'Format not supported by DAC (DoP): DSD512 is not available as DoP on this device',
        'en',
      ),
    ).toBe('DSD512 cannot be played through DoP on this device.');
  });

  it('does not leak unknown backend text into the Vietnamese UI', () => {
    expect(localizeAudioError('Unexpected backend detail', 'vi')).toBe(
      'Không thể phát file âm thanh này.',
    );
  });
});

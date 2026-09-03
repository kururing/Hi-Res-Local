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

  it('does not mislabel a file decoder failure as a DAC rejection', () => {
    expect(
      localizeAudioError(
        'WASAPI Shared: Audio format unsupported for path broken.dsf: invalid DSF header',
        'vi',
      ),
    ).toBe('Ứng dụng không đọc được định dạng hoặc cấu trúc của file âm thanh này.');

    expect(
      localizeAudioError(
        'Format not supported by DAC (PCM 24-bit / 384 kHz): endpoint rejected format',
        'vi',
      ),
    ).toBe('DAC không hỗ trợ định dạng âm thanh được yêu cầu.');
  });

  it('localizes browser streaming errors', () => {
    expect(localizeAudioError('Autoplay was blocked by the browser', 'vi'))
      .toBe('Trình duyệt đã chặn tự động phát. Hãy nhấn phát để tiếp tục.');
    expect(localizeAudioError('This browser cannot play the selected audio format', 'en'))
      .toBe('This browser cannot play the selected audio format.');
    expect(localizeAudioError('The signed audio URL expired', 'vi'))
      .toBe('Liên kết phát đã hết hạn. Hãy thử phát lại.');
    expect(
      localizeAudioError(
        'This hi-res file cannot stream because the server did not honor HTTP Range',
        'vi',
      ),
    ).toBe('File hi-res này không phát được vì máy chủ không hỗ trợ HTTP Range.');
    expect(
      localizeAudioError(
        'Cloud HTTP streams cannot use Native DSD or DoP; choose DSD → PCM or play a local file',
        'en',
      ),
    ).toBe('Cloud tracks cannot use Native DSD or DoP. Choose DSD → PCM or play a local file.');
  });
});

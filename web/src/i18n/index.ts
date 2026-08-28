import { vi } from './vi';
import { en } from './en';
import { AppLanguage } from '../types/settings';

export const translations = {
  vi,
  en,
};

export type TranslationKey = keyof typeof vi;

export function t(key: TranslationKey, lang: AppLanguage = 'vi', params?: Record<string, string | number>): string {
  const dict = translations[lang] || translations.vi;
  let text: string = dict[key] || translations.vi[key] || (key as string);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

/** Convert backend audio errors into user-facing text in the selected language. */
export function localizeAudioError(message: string, lang: AppLanguage = 'vi'): string {
  const dsdRate = message.match(/\bDSD(?:64|128|256|512)\b/i)?.[0]?.toUpperCase();
  if (dsdRate && /not available as DoP|cannot be played through DoP/i.test(message)) {
    return t('audio_error_dop_rate_unavailable', lang, { rate: dsdRate });
  }
  if (/DoP is not available on this device/i.test(message)) {
    return t('audio_error_dop_unavailable', lang);
  }
  if (/No ASIO driver is installed/i.test(message)) {
    return t('audio_error_no_asio_driver', lang);
  }
  if (/No installed ASIO driver supports Native DSD/i.test(message)) {
    return t('audio_error_asio_native_dsd_unavailable', lang);
  }
  if (/Audio device unavailable or disconnected/i.test(message)) {
    return t('audio_error_device_unavailable', lang);
  }
  if (/Format not supported by DAC|Audio format unsupported/i.test(message)) {
    return t('audio_error_format_unsupported', lang);
  }
  if (/General playback error|decoder error|stream playback error/i.test(message)) {
    return t('audio_error_playback', lang);
  }
  return lang === 'vi' ? t('audio_error_playback', lang) : message;
}

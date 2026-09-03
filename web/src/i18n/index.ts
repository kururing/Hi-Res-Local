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
  if (/Format not supported by DAC/i.test(message)) {
    return t('audio_error_format_unsupported', lang);
  }
  if (/Audio format unsupported for path/i.test(message)) {
    return t('audio_error_file_format_unsupported', lang);
  }
  if (/Autoplay was blocked by the browser/i.test(message)) {
    return t('audio_error_autoplay_blocked', lang);
  }
  if (/cannot play the selected audio format/i.test(message)) {
    return t('audio_error_browser_format_unsupported', lang);
  }
  if (/audio stream could not be loaded/i.test(message)) {
    return t('audio_error_stream_network', lang);
  }
  if (/could not decode this audio stream/i.test(message)) {
    return t('audio_error_stream_decode', lang);
  }
  if (/No playable audio source is available/i.test(message)) {
    return t('audio_error_stream_unavailable', lang);
  }
  if (/signed audio URL expired/i.test(message)) {
    return t('audio_error_signed_url_expired', lang);
  }
  if (/requested stream quality is not available/i.test(message)) {
    return t('audio_error_stream_quality_unavailable', lang);
  }
  if (/Your session expired\. Sign in again to play music/i.test(message)) {
    return t('audio_error_auth_expired', lang);
  }
  if (/did not honor HTTP Range/i.test(message)) {
    return t('audio_error_range_required', lang);
  }
  if (/exceeds the bounded fallback limit/i.test(message)) {
    return t('audio_error_bounded_fallback', lang);
  }
  if (/Cloud HTTP streams cannot use Native DSD or DoP/i.test(message)) {
    return t('audio_error_cloud_dsd_native', lang);
  }
  if (/General playback error|decoder error|stream playback error/i.test(message)) {
    return t('audio_error_playback', lang);
  }
  return lang === 'vi' ? t('audio_error_playback', lang) : message;
}

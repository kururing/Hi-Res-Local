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

import { ReplayGainMode } from './audio';

export type AppTheme = 'oled' | 'midnight' | 'slate' | 'light' | 'custom';
export type AppLanguage = 'vi' | 'en';
export type AppFont = 'poppins' | 'inter' | 'manrope' | 'nunito' | 'lora' | 'system';

export interface CustomImageTheme {
  id?: string;
  name?: string;
  image_data_url: string;
  is_dark: boolean;
  palette?: string[];
  selected_palette_index?: number;
  colors: {
    base: string;
    card: string;
    hover: string;
    active: string;
    primary: string;
    secondary: string;
    accent: string;
    accent_hover: string;
    foreground: string;
    muted: string;
    border: string;
  };
}

export interface AppSettings {
  music_folders: string[];
  auto_watch: boolean;
  output_device: string;
  wasapi_exclusive: boolean;
  bit_perfect: boolean;
  crossfade_duration: number; // 0 to 12 seconds
  replay_gain_mode: ReplayGainMode;
  replay_gain_preamp: number; // -12 to +12 dB
  language: AppLanguage;
  theme: AppTheme;
  font_family: AppFont;
  custom_image_theme?: CustomImageTheme;
  custom_image_themes: CustomImageTheme[];
  custom_theme_blur: boolean;
  custom_theme_blur_percent: number;
  launch_on_startup: boolean;
  close_to_tray: boolean;
  discord_presence_enabled: boolean;
  eq_enabled: boolean;
  eq_preset_id: string;
  eq_custom_gains: number[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  music_folders: [],
  auto_watch: true,
  output_device: 'default',
  wasapi_exclusive: false,
  bit_perfect: false,
  crossfade_duration: 0,
  replay_gain_mode: 'off',
  replay_gain_preamp: 0,
  language: 'vi',
  theme: 'oled',
  font_family: 'poppins',
  custom_image_theme: undefined,
  custom_image_themes: [],
  custom_theme_blur: true,
  custom_theme_blur_percent: 50,
  launch_on_startup: false,
  close_to_tray: false,
  discord_presence_enabled: false,
  eq_enabled: false,
  eq_preset_id: 'flat',
  eq_custom_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** User-facing Bit-Perfect mode requires both WASAPI Exclusive and native PCM. */
export function isWasapiExclusiveMode(
  settings: Pick<AppSettings, 'wasapi_exclusive' | 'bit_perfect'>
): boolean {
  return settings.wasapi_exclusive && settings.bit_perfect;
}

/** Toggle the single user-facing Bit-Perfect + WASAPI Exclusive mode. */
export function withWasapiExclusiveMode(
  enabled: boolean
): Pick<AppSettings, 'wasapi_exclusive' | 'bit_perfect'> {
  return { wasapi_exclusive: enabled, bit_perfect: enabled };
}

/** Keep persisted audio flags atomic: either both are on or both are off. */
export function normalizeWasapiExclusiveSettings(settings: AppSettings): AppSettings {
  const enabled = settings.wasapi_exclusive && settings.bit_perfect;
  return { ...settings, wasapi_exclusive: enabled, bit_perfect: enabled };
}

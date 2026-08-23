import { ReplayGainMode } from './audio';

export type AppTheme = 'oled' | 'midnight' | 'slate' | 'light';
export type AppLanguage = 'vi' | 'en';

export interface AppSettings {
  music_folders: string[];
  auto_watch: boolean;
  output_device: string;
  bit_perfect: boolean;
  crossfade_duration: number; // 0 to 12 seconds
  replay_gain_mode: ReplayGainMode;
  replay_gain_preamp: number; // -12 to +12 dB
  language: AppLanguage;
  theme: AppTheme;
  eq_enabled: boolean;
  eq_preset_id: string;
  eq_custom_gains: number[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  music_folders: [],
  auto_watch: true,
  output_device: 'default',
  bit_perfect: false,
  crossfade_duration: 0,
  replay_gain_mode: 'off',
  replay_gain_preamp: 0,
  language: 'vi',
  theme: 'oled',
  eq_enabled: false,
  eq_preset_id: 'flat',
  eq_custom_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

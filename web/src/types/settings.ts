import { AudioBackend, DsdOutputMode, PlaybackMode, ReplayGainMode } from './audio';
import {
  DEFAULT_STREAM_QUALITY,
  normalizeStreamingQuality,
  type StreamQuality,
} from '@nnpm/audio-contracts';

export type { StreamQuality };
export { normalizeStreamingQuality };

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
  /** Preserve the encoded PCM payload for an external MQA Full Decoder. */
  mqa_passthrough: boolean;
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
  artwork_adaptive_theme: boolean;
  launch_on_startup: boolean;
  close_to_tray: boolean;
  discord_presence_enabled: boolean;
  eq_enabled: boolean;
  eq_preset_id: string;
  eq_custom_gains: number[];
  dsd_output_mode: DsdOutputMode;
  audio_backend: AudioBackend;
  asio_driver_id: string | null;
  playback_mode: PlaybackMode;
  streaming_quality: StreamQuality;
}

export const DEFAULT_SETTINGS: AppSettings = {
  music_folders: [],
  auto_watch: true,
  output_device: 'default',
  wasapi_exclusive: false,
  bit_perfect: false,
  mqa_passthrough: false,
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
  artwork_adaptive_theme: true,
  launch_on_startup: false,
  close_to_tray: false,
  discord_presence_enabled: false,
  eq_enabled: false,
  eq_preset_id: 'flat',
  eq_custom_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dsd_output_mode: 'pcm',
  audio_backend: 'shared',
  asio_driver_id: null,
  playback_mode: 'auto',
  streaming_quality: DEFAULT_STREAM_QUALITY,
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

const PLAYBACK_MODES: readonly PlaybackMode[] = ['auto', 'high_quality', 'multitask', 'advanced'];
const DSD_OUTPUT_MODES: readonly DsdOutputMode[] = ['native_dsd', 'dop', 'pcm'];
const AUDIO_BACKENDS: readonly AudioBackend[] = ['shared', 'wasapi_exclusive', 'asio'];

/**
 * Migrate persisted audio settings to the playback-mode model and derive the
 * legacy flags one-way from the chosen mode (the mode is the source of truth).
 */
export function normalizeAudioSettings(settings: AppSettings): AppSettings {
  // MQA passthrough is a protected PCM path: exact source format, unity gain,
  // no DSP, and no Windows mixer. The Rust Exclusive bit-perfect wire already
  // provides those guarantees, so keep this preset as a strict configuration.
  if (settings.mqa_passthrough) {
    return {
      ...settings,
      streaming_quality: normalizeStreamingQuality(settings.streaming_quality),
      playback_mode: 'advanced',
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'pcm',
      wasapi_exclusive: true,
      bit_perfect: true,
      mqa_passthrough: true,
    };
  }

  let mode: PlaybackMode;
  if (PLAYBACK_MODES.includes(settings.playback_mode)) {
    mode = settings.playback_mode;
  } else if (settings.wasapi_exclusive && settings.bit_perfect) {
    mode = 'high_quality';
  } else if (
    !settings.wasapi_exclusive &&
    !settings.bit_perfect &&
    settings.audio_backend === 'shared' &&
    settings.dsd_output_mode !== 'native_dsd'
  ) {
    mode = 'multitask';
  } else {
    mode = 'auto';
  }

  if (mode === 'high_quality') {
    return {
      ...settings,
      streaming_quality: normalizeStreamingQuality(settings.streaming_quality),
      playback_mode: mode,
      wasapi_exclusive: true,
      bit_perfect: true,
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'pcm',
      mqa_passthrough: false,
    };
  }

  if (mode === 'advanced') {
    const backend = AUDIO_BACKENDS.includes(settings.audio_backend) ? settings.audio_backend : 'shared';
    let dsdOutputMode = DSD_OUTPUT_MODES.includes(settings.dsd_output_mode) ? settings.dsd_output_mode : 'pcm';
    let resolvedBackend = backend;
    // ASIO has no PCM/DoP path; pairing it with anything but Native DSD is a
    // dead control that still looks selected.
    if (resolvedBackend === 'asio') {
      dsdOutputMode = 'native_dsd';
    } else if (resolvedBackend === 'shared' && dsdOutputMode === 'dop') {
      // DoP cannot survive the Windows mixer; Shared means DSD → PCM.
      dsdOutputMode = 'pcm';
    } else if (dsdOutputMode === 'dop') {
      resolvedBackend = 'wasapi_exclusive';
    }
    const exclusive = resolvedBackend === 'wasapi_exclusive';
    return {
      ...settings,
      streaming_quality: normalizeStreamingQuality(settings.streaming_quality),
      playback_mode: mode,
      audio_backend: resolvedBackend,
      dsd_output_mode: dsdOutputMode,
      wasapi_exclusive: exclusive,
      bit_perfect: exclusive,
      mqa_passthrough: false,
    };
  }

  // 'auto' and 'multitask' share the same safe shared-mode legacy flags.
  return {
    ...settings,
    streaming_quality: normalizeStreamingQuality(settings.streaming_quality),
    playback_mode: mode,
    wasapi_exclusive: false,
    bit_perfect: false,
    mqa_passthrough: false,
    audio_backend: 'shared',
    dsd_output_mode: 'pcm',
  };
}

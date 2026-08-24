import { Track } from './library';

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';
export type LoopMode = 'off' | 'track' | 'playlist';

export interface PlaybackStatus {
  state: PlaybackState;
  current_track: Track | null;
  position: number; // in seconds
  duration: number; // in seconds
  volume: number; // 0.0 to 1.0
  is_muted: boolean;
  loop_mode: LoopMode;
  shuffle: boolean;
}

export interface AudioOutputDevice {
  id: string;
  name: string;
  is_default: boolean;
  sample_rates?: number[];
}

export interface AudioCapabilities {
  exclusive_mode_supported: boolean;
  media_controls_supported: boolean;
  gapless_supported: boolean;
  replay_gain_supported: boolean;
  equalizer_supported: boolean;
}

export interface EqualizerBand {
  frequency: number; // e.g. 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
  label: string; // e.g. "31Hz", "1kHz"
  gain: number; // -12.0 to +12.0 dB
}

export interface EqualizerPreset {
  id: string;
  name: string;
  gains: number[]; // 10 band gains
  is_custom?: boolean;
}

export type ReplayGainMode = 'off' | 'track' | 'album';

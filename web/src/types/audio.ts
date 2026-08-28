import { Track } from './library';

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';
export type LoopMode = 'off' | 'track' | 'playlist';
export type PlaybackMode = 'auto' | 'high_quality' | 'multitask' | 'advanced';
export type DsdOutputMode = 'native_dsd' | 'dop' | 'pcm';
export type AudioBackend = 'shared' | 'wasapi_exclusive' | 'asio';
export type DsdRate = 'dsd64' | 'dsd128' | 'dsd256' | 'dsd512';
export type VolumeControlKind = 'windows_endpoint' | 'software';

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
  bit_depths?: number[];
  channels?: number[];
  backend?: AudioBackend;
  asio_driver_id?: string | null;
  native_dsd_supported?: boolean;
  dsd_rates?: DsdRate[];
}

export interface AsioDriver {
  id: string;
  name: string;
  native_dsd_supported: boolean;
  dsd_rates: DsdRate[];
}

export interface AudioCapabilities {
  exclusive_mode_supported: boolean;
  media_controls_supported: boolean;
  gapless_supported: boolean;
  replay_gain_supported: boolean;
  equalizer_supported: boolean;
  asio_supported: boolean;
  native_dsd_supported: boolean;
  /** Truly probed by the backend; may be empty when nothing can be verified. */
  dsd_rates: DsdRate[];
  dop_supported: boolean;
  dop_rates: DsdRate[];
  asio_drivers_present: boolean;
}

/** Live exclusive-engine status from the Rust WASAPI path. */
export interface EngineStatus {
  output_mode: string;
  bit_perfect: boolean;
  is_native: boolean;
  output_sample_rate: number;
  output_bit_depth: number;
  source_label: string;
  backend?: AudioBackend;
  dsd_output_mode?: DsdOutputMode;
  dsd_rate?: DsdRate | null;
  native_dsd_error?: string | null;
  /** e.g. "DSD128" or "FLAC 24-bit / 96 kHz" */
  source_format: string;
  source_sample_rate: number;
  /** 1 for DSD sources. */
  source_bit_depth: number;
  /** Set only when the current source is DSD. */
  dsd_transport?: DsdOutputMode | null;
  /** e.g. "PCM 24-bit / 352.8 kHz (DoP)", "DSD 5.6 MHz (Native)" */
  output_format: string;
  volume: number;
  volume_control_kind: VolumeControlKind;
  /** Set when Auto/HQ fell back from a better path. */
  fallback_reason?: string | null;
}

export interface SystemAudioState {
  volume: number;
  is_muted: boolean;
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

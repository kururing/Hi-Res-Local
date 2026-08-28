import { describe, expect, it } from 'vitest';
import { AppSettings, DEFAULT_SETTINGS, normalizeAudioSettings } from '../types/settings';
import { PlaybackMode } from '../types/audio';

/** Legacy persisted payloads have no playback_mode; simulate that. */
function legacy(partial: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    playback_mode: (partial.playback_mode ?? '') as PlaybackMode,
  };
}

describe('playback mode migration (normalizeAudioSettings)', () => {
  it('keeps an already-valid playback_mode', () => {
    for (const mode of ['auto', 'high_quality', 'multitask', 'advanced'] as const) {
      const normalized = normalizeAudioSettings({ ...DEFAULT_SETTINGS, playback_mode: mode });
      expect(normalized.playback_mode).toBe(mode);
    }
  });

  it('migrates wasapi_exclusive + bit_perfect to high_quality', () => {
    const normalized = normalizeAudioSettings(legacy({
      wasapi_exclusive: true,
      bit_perfect: true,
    }));
    expect(normalized.playback_mode).toBe('high_quality');
  });

  it('migrates plain shared non-native-DSD setups to multitask', () => {
    const normalized = normalizeAudioSettings(legacy({
      wasapi_exclusive: false,
      bit_perfect: false,
      audio_backend: 'shared',
      dsd_output_mode: 'pcm',
    }));
    expect(normalized.playback_mode).toBe('multitask');
  });

  it('migrates the old contradictory default (native_dsd + shared, toggles off) to auto', () => {
    const normalized = normalizeAudioSettings(legacy({
      wasapi_exclusive: false,
      bit_perfect: false,
      audio_backend: 'shared',
      dsd_output_mode: 'native_dsd',
    }));
    expect(normalized.playback_mode).toBe('auto');
    expect(normalized.dsd_output_mode).toBe('pcm');
  });

  it('migrates partial/invalid states to auto', () => {
    // Partial exclusive flags do not qualify for high_quality or multitask.
    expect(normalizeAudioSettings(legacy({
      wasapi_exclusive: true,
      bit_perfect: false,
    })).playback_mode).toBe('auto');

    // Invalid enum garbage from a corrupted payload.
    expect(normalizeAudioSettings(legacy({
      playback_mode: 'turbo' as PlaybackMode,
      audio_backend: 'pipewire' as AppSettings['audio_backend'],
      dsd_output_mode: 'raw' as AppSettings['dsd_output_mode'],
    })).playback_mode).toBe('auto');
  });

  it('never yields native_dsd + shared for non-advanced modes', () => {
    const candidates: AppSettings[] = [
      legacy({ dsd_output_mode: 'native_dsd', audio_backend: 'shared' }),
      legacy({ wasapi_exclusive: true, bit_perfect: true, dsd_output_mode: 'native_dsd' }),
      { ...DEFAULT_SETTINGS, playback_mode: 'auto', dsd_output_mode: 'native_dsd', audio_backend: 'shared' },
      { ...DEFAULT_SETTINGS, playback_mode: 'multitask', dsd_output_mode: 'native_dsd', audio_backend: 'shared' },
      { ...DEFAULT_SETTINGS, playback_mode: 'high_quality', dsd_output_mode: 'native_dsd', audio_backend: 'shared' },
    ];
    for (const input of candidates) {
      const normalized = normalizeAudioSettings(input);
      if (normalized.playback_mode !== 'advanced') {
        expect(
          normalized.dsd_output_mode === 'native_dsd' && normalized.audio_backend === 'shared'
        ).toBe(false);
      }
    }
  });

  it('derives legacy fields one-way for auto', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'auto',
      wasapi_exclusive: true,
      bit_perfect: true,
      audio_backend: 'asio',
      dsd_output_mode: 'native_dsd',
    });
    expect(normalized).toMatchObject({
      playback_mode: 'auto',
      wasapi_exclusive: false,
      bit_perfect: false,
      audio_backend: 'shared',
      dsd_output_mode: 'pcm',
    });
  });

  it('derives legacy fields one-way for high_quality', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'high_quality',
      wasapi_exclusive: false,
      bit_perfect: false,
      audio_backend: 'shared',
      dsd_output_mode: 'native_dsd',
    });
    expect(normalized).toMatchObject({
      playback_mode: 'high_quality',
      wasapi_exclusive: true,
      bit_perfect: true,
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'pcm',
    });
  });

  it('derives legacy fields one-way for multitask', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'multitask',
      wasapi_exclusive: true,
      bit_perfect: true,
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'dop',
    });
    expect(normalized).toMatchObject({
      playback_mode: 'multitask',
      wasapi_exclusive: false,
      bit_perfect: false,
      audio_backend: 'shared',
      dsd_output_mode: 'pcm',
    });
  });

  it('keeps user choices in advanced mode while enforcing invariants', () => {
    const kept = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'asio',
      dsd_output_mode: 'dop',
      asio_driver_id: 'driver-1',
      wasapi_exclusive: true,
      bit_perfect: false,
    });
    expect(kept).toMatchObject({
      playback_mode: 'advanced',
      audio_backend: 'asio',
      dsd_output_mode: 'native_dsd',
      asio_driver_id: 'driver-1',
      // Exclusive flags are only true when the backend is wasapi_exclusive.
      wasapi_exclusive: false,
      bit_perfect: false,
    });

    const exclusive = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'pcm',
      wasapi_exclusive: false,
      bit_perfect: false,
    });
    expect(exclusive.wasapi_exclusive).toBe(true);
    expect(exclusive.bit_perfect).toBe(true);
  });

  it('drops DoP to DSD → PCM when Advanced backend is Shared', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'shared',
      dsd_output_mode: 'dop',
    });
    expect(normalized.audio_backend).toBe('shared');
    expect(normalized.dsd_output_mode).toBe('pcm');
  });

  it('keeps DoP on WASAPI Exclusive', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'dop',
    });
    expect(normalized.audio_backend).toBe('wasapi_exclusive');
    expect(normalized.dsd_output_mode).toBe('dop');
    expect(normalized.wasapi_exclusive).toBe(true);
  });

  it('forces Native DSD when the Advanced backend is ASIO', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'asio',
      dsd_output_mode: 'pcm',
    });
    expect(normalized.audio_backend).toBe('asio');
    expect(normalized.dsd_output_mode).toBe('native_dsd');
  });

  it('sanitizes invalid enum values in advanced mode', () => {
    const normalized = normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'jack' as AppSettings['audio_backend'],
      dsd_output_mode: 'dsd_raw' as AppSettings['dsd_output_mode'],
    });
    expect(normalized.audio_backend).toBe('shared');
    expect(normalized.dsd_output_mode).toBe('pcm');
    expect(normalized.wasapi_exclusive).toBe(false);
    expect(normalized.bit_perfect).toBe(false);
  });

  it('defaults are already normalized', () => {
    expect(DEFAULT_SETTINGS.playback_mode).toBe('auto');
    expect(DEFAULT_SETTINGS.dsd_output_mode).toBe('pcm');
    expect(normalizeAudioSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

import { describe, expect, it } from 'vitest';
import { dsdTransportLabel, engineSourceDisplay, engineTransportDisplay, getAdvancedOptionGating, coerceUnavailableAudioOptions, volumeControlLabel, isEqualizerAvailable } from '../services/playbackDisplay';
import { DEFAULT_SETTINGS } from '../types/settings';

describe('dsdTransportLabel', () => {
  it('labels the three explicit transports', () => {
    expect(dsdTransportLabel({ dsd_transport: 'native_dsd' })).toBe('ASIO Native DSD');
    expect(dsdTransportLabel({ dsd_transport: 'dop' })).toBe('DoP');
    expect(dsdTransportLabel({ dsd_transport: 'pcm' })).toBe('DSD → PCM');
  });

  it('prefers dsd_transport over legacy fields', () => {
    expect(dsdTransportLabel({
      dsd_transport: 'dop',
      dsd_output_mode: 'native_dsd',
      backend: 'asio',
      output_mode: 'ASIO Native DSD',
    })).toBe('DoP');
    expect(dsdTransportLabel({
      dsd_transport: 'pcm',
      backend: 'asio',
    })).toBe('DSD → PCM');
  });

  it('falls back to legacy fields when dsd_transport is absent', () => {
    expect(dsdTransportLabel({ dsd_output_mode: 'native_dsd' })).toBe('ASIO Native DSD');
    expect(dsdTransportLabel({ backend: 'asio' })).toBe('ASIO Native DSD');
    expect(dsdTransportLabel({ output_mode: 'ASIO Native DSD' })).toBe('ASIO Native DSD');
    expect(dsdTransportLabel({ output_mode: 'WASAPI Shared' })).toBe('DSD → PCM');
    expect(dsdTransportLabel(null)).toBe('DSD → PCM');
    expect(dsdTransportLabel(undefined)).toBe('DSD → PCM');
  });
});

describe('getAdvancedOptionGating', () => {
  it('disables everything when capabilities are unknown', () => {
    expect(getAdvancedOptionGating(null)).toEqual({
      asioBackendDisabled: true,
      nativeDsdDisabled: true,
      dopDisabled: true,
      exclusiveBackendDisabled: false,
    });
  });

  it('disables ASIO and native DSD when no ASIO drivers are present', () => {
    const gating = getAdvancedOptionGating({
      asio_drivers_present: false,
      native_dsd_supported: false,
      dop_supported: true,
      exclusive_mode_supported: true,
    });
    expect(gating.asioBackendDisabled).toBe(true);
    expect(gating.nativeDsdDisabled).toBe(true);
    expect(gating.dopDisabled).toBe(false);
    expect(gating.exclusiveBackendDisabled).toBe(false);
  });

  it('enables options that the backend probed as supported', () => {
    expect(getAdvancedOptionGating({
      asio_drivers_present: true,
      native_dsd_supported: true,
      dop_supported: true,
      exclusive_mode_supported: true,
    })).toEqual({
      asioBackendDisabled: false,
      nativeDsdDisabled: false,
      dopDisabled: false,
      exclusiveBackendDisabled: false,
    });
  });

  it('disables ASIO backend when a driver is present but Native DSD is not', () => {
    const gating = getAdvancedOptionGating({
      asio_drivers_present: true,
      native_dsd_supported: false,
      dop_supported: true,
      exclusive_mode_supported: true,
    });
    expect(gating.asioBackendDisabled).toBe(true);
    expect(gating.nativeDsdDisabled).toBe(true);
    expect(gating.dopDisabled).toBe(false);
  });

  it('disables DoP when Exclusive is unavailable', () => {
    expect(getAdvancedOptionGating({
      asio_drivers_present: false,
      native_dsd_supported: false,
      dop_supported: true,
      exclusive_mode_supported: false,
    }).dopDisabled).toBe(true);
  });

  it('disables Exclusive when the endpoint does not support it', () => {
    expect(getAdvancedOptionGating({
      asio_drivers_present: false,
      native_dsd_supported: false,
      dop_supported: false,
      exclusive_mode_supported: false,
    }).exclusiveBackendDisabled).toBe(true);
  });
});

describe('coerceUnavailableAudioOptions', () => {
  const advanced = {
    ...DEFAULT_SETTINGS,
    playback_mode: 'advanced' as const,
  };

  it('leaves Auto/High quality/Multitask modes untouched', () => {
    const auto = coerceUnavailableAudioOptions(
      { ...DEFAULT_SETTINGS, playback_mode: 'auto', audio_backend: 'asio' },
      { native_dsd_supported: false, dop_supported: false, exclusive_mode_supported: false }
    );
    expect(auto.playback_mode).toBe('auto');
    expect(auto.audio_backend).toBe('shared');
  });

  it('falls ASIO Native DSD back to Exclusive PCM when Native and DoP are gone', () => {
    const next = coerceUnavailableAudioOptions(
      { ...advanced, audio_backend: 'asio', dsd_output_mode: 'native_dsd' },
      { native_dsd_supported: false, dop_supported: false, exclusive_mode_supported: true }
    );
    expect(next.audio_backend).toBe('wasapi_exclusive');
    expect(next.dsd_output_mode).toBe('pcm');
  });

  it('falls ASIO Native DSD back to Shared + PCM when Exclusive is also unavailable', () => {
    const next = coerceUnavailableAudioOptions(
      { ...advanced, audio_backend: 'asio', dsd_output_mode: 'native_dsd' },
      { native_dsd_supported: false, dop_supported: false, exclusive_mode_supported: false }
    );
    expect(next.audio_backend).toBe('shared');
    expect(next.dsd_output_mode).toBe('pcm');
  });

  it('falls Native DSD back to DoP when the new device still supports DoP', () => {
    const next = coerceUnavailableAudioOptions(
      { ...advanced, audio_backend: 'asio', dsd_output_mode: 'native_dsd' },
      { native_dsd_supported: false, dop_supported: true, exclusive_mode_supported: true }
    );
    expect(next.audio_backend).toBe('wasapi_exclusive');
    expect(next.dsd_output_mode).toBe('dop');
  });

  it('falls DoP back to DSD → PCM when the new device cannot do DoP', () => {
    const next = coerceUnavailableAudioOptions(
      { ...advanced, audio_backend: 'wasapi_exclusive', dsd_output_mode: 'dop' },
      { native_dsd_supported: false, dop_supported: false, exclusive_mode_supported: true }
    );
    expect(next.audio_backend).toBe('wasapi_exclusive');
    expect(next.dsd_output_mode).toBe('pcm');
  });

  it('falls Exclusive back to Shared when the endpoint cannot open Exclusive', () => {
    const next = coerceUnavailableAudioOptions(
      { ...advanced, audio_backend: 'wasapi_exclusive', dsd_output_mode: 'pcm' },
      { native_dsd_supported: false, dop_supported: false, exclusive_mode_supported: false }
    );
    expect(next.audio_backend).toBe('shared');
    expect(next.dsd_output_mode).toBe('pcm');
  });

  it('keeps ASIO Native DSD when the new device still supports it', () => {
    const next = coerceUnavailableAudioOptions(
      { ...advanced, audio_backend: 'asio', dsd_output_mode: 'native_dsd' },
      { native_dsd_supported: true, dop_supported: true, exclusive_mode_supported: true }
    );
    expect(next.audio_backend).toBe('asio');
    expect(next.dsd_output_mode).toBe('native_dsd');
  });
});

describe('engineSourceDisplay / engineTransportDisplay', () => {
  it('labels DoP without calling it a PCM conversion', () => {
    expect(engineSourceDisplay({
      source_format: 'DSD128',
      source_label: 'DSD128 • DSF • DoP',
      dsd_rate: 'dsd128',
      dsd_transport: 'dop',
    })).toBe('DSD128 (DoP)');
    expect(engineTransportDisplay({
      output_format: 'PCM 24-bit / 352.8 kHz (DoP)',
      output_mode: 'WASAPI Exclusive (DoP)',
      dsd_transport: 'dop',
    })).toBe('DoP • 24-bit/352.8 kHz');
    expect(engineTransportDisplay({
      output_format: 'PCM 24-bit / 352.8 kHz (DoP)',
      output_mode: 'WASAPI Exclusive (DoP)',
      dsd_transport: 'dop',
    })).toBe('DoP • 24-bit/352.8 kHz');
  });

  it('labels DSD → PCM conversion distinctly from DoP', () => {
    expect(engineSourceDisplay({
      source_format: 'DSD128',
      source_label: 'DSD128 • DSF',
      dsd_rate: 'dsd128',
      dsd_transport: 'pcm',
    })).toBe('DSD128 → PCM');
    expect(engineTransportDisplay({
      output_format: 'PCM 24-bit / 352.8 kHz',
      output_mode: 'WASAPI Exclusive',
      dsd_transport: 'pcm',
    })).toBe('PCM 24-bit / 352.8 kHz');
  });

  it('never reports Analog volume', () => {
    expect(volumeControlLabel('windows_endpoint')).toBe('Windows Endpoint');
    expect(volumeControlLabel('software')).toBe('Software');
    expect(volumeControlLabel(undefined)).toBe('Software');
  });
});

describe('isEqualizerAvailable', () => {
  it('allows EQ on Shared and Exclusive PCM conversion', () => {
    expect(isEqualizerAvailable(null, DEFAULT_SETTINGS)).toBe(true);
    expect(isEqualizerAvailable({ backend: 'shared', bit_perfect: false })).toBe(true);
    expect(isEqualizerAvailable({
      backend: 'wasapi_exclusive',
      bit_perfect: false,
      dsd_transport: 'pcm',
    })).toBe(true);
  });

  it('blocks EQ when the live path bypasses DSP', () => {
    expect(isEqualizerAvailable({ bit_perfect: true })).toBe(false);
    expect(isEqualizerAvailable({ is_native: true })).toBe(false);
    expect(isEqualizerAvailable({ dsd_transport: 'dop' })).toBe(false);
    expect(isEqualizerAvailable({ dsd_transport: 'native_dsd' })).toBe(false);
    expect(isEqualizerAvailable({ backend: 'asio' })).toBe(false);
  });

  it('blocks EQ in Advanced Native DSD / DoP before playback starts', () => {
    expect(isEqualizerAvailable(null, {
      ...DEFAULT_SETTINGS,
      mqa_passthrough: true,
    })).toBe(false);
    expect(isEqualizerAvailable(null, {
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'asio',
      dsd_output_mode: 'native_dsd',
    })).toBe(false);
    expect(isEqualizerAvailable(null, {
      ...DEFAULT_SETTINGS,
      playback_mode: 'advanced',
      audio_backend: 'wasapi_exclusive',
      dsd_output_mode: 'dop',
    })).toBe(false);
  });

  it('re-enables EQ when Advanced Native still falls through to Shared PCM', () => {
    expect(isEqualizerAvailable(
      { backend: 'shared', bit_perfect: false },
      {
        ...DEFAULT_SETTINGS,
        playback_mode: 'advanced',
        audio_backend: 'asio',
        dsd_output_mode: 'native_dsd',
      },
    )).toBe(true);
  });
});

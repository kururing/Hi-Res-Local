import type { AudioBackend, AudioCapabilities, DsdOutputMode, EngineStatus } from '../types/audio';
import type { AppSettings } from '../types/settings';
import { normalizeAudioSettings } from '../types/settings';

export type DsdTransportLabel = 'ASIO Native DSD' | 'DoP' | 'DSD → PCM';

/**
 * Human label for how a DSD source reaches the device. Prefers the explicit
 * `dsd_transport` reported by the engine; falls back to legacy fields emitted
 * by older backends that predate the playback-mode refactor.
 */
export function dsdTransportLabel(
  status:
    | Partial<Pick<EngineStatus, 'dsd_transport' | 'dsd_output_mode' | 'backend' | 'output_mode'>>
    | null
    | undefined
): DsdTransportLabel {
  switch (status?.dsd_transport) {
    case 'native_dsd':
      return 'ASIO Native DSD';
    case 'dop':
      return 'DoP';
    case 'pcm':
      return 'DSD → PCM';
    default:
      break;
  }
  const legacyNative =
    status?.dsd_output_mode === 'native_dsd' ||
    status?.backend === 'asio' ||
    /ASIO Native DSD/i.test(status?.output_mode || '');
  return legacyNative ? 'ASIO Native DSD' : 'DSD → PCM';
}

/** Source format as shown in settings / player: `DSD128 (DoP)` vs `DSD128 → PCM`. */
export function engineSourceDisplay(
  status: Pick<EngineStatus, 'source_format' | 'source_label' | 'dsd_rate' | 'dsd_transport'> | null | undefined
): string {
  if (!status) return '—';
  const rate = status.dsd_rate
    ? status.dsd_rate.toUpperCase()
    : status.source_format || '';
  if (status.dsd_transport === 'dop') {
    return `${rate || 'DSD'} (DoP)`;
  }
  if (status.dsd_transport === 'pcm') {
    return `${rate || status.source_format || 'DSD'} → PCM`;
  }
  if (status.dsd_transport === 'native_dsd') {
    return `${rate || 'DSD'} (Native)`;
  }
  return status.source_format || status.source_label || '—';
}

/**
 * What is actually sent to the device. DoP keeps the DSD payload intact, so
 * describe its PCM-shaped wire format as a carrier instead of a conversion.
 */
export function engineTransportDisplay(
  status: Pick<EngineStatus, 'output_format' | 'output_mode' | 'dsd_transport'> | null | undefined,
): string {
  if (!status) return '—';
  if (status.dsd_transport === 'dop') {
    const carrier = (status.output_format || status.output_mode || '')
      .replace(/^PCM\s*/i, '')
      .replace(/\s*\(DoP\)\s*$/i, '')
      .trim();
    const carrierLabel = carrier || '—';
    return `DoP • ${carrierLabel.replace(/\s*\/\s*/, '/')}`;
  }
  return status.output_format || status.output_mode || '—';
}

export function volumeControlLabel(kind: EngineStatus['volume_control_kind'] | undefined): string {
  return kind === 'windows_endpoint' ? 'Windows Endpoint' : 'Software';
}

/**
 * EQ (and the rest of the software DSP chain) only runs on Shared and
 * Exclusive PCM conversion. Bit-perfect WASAPI, DoP, and ASIO Native DSD
 * copy samples straight to the device.
 */
export function isEqualizerAvailable(
  engine:
    | Partial<Pick<EngineStatus, 'bit_perfect' | 'is_native' | 'dsd_transport' | 'backend' | 'output_mode'>>
    | null
    | undefined,
  settings?: Pick<AppSettings, 'playback_mode' | 'audio_backend' | 'dsd_output_mode'> | null,
): boolean {
  const engineUsesDsp =
    engine?.dsd_transport === 'pcm' ||
    engine?.backend === 'shared' ||
    (engine?.backend === 'wasapi_exclusive' && engine?.bit_perfect === false);

  if (engineUsesDsp) {
    return true;
  }

  if (
    engine?.bit_perfect === true ||
    engine?.is_native === true ||
    engine?.dsd_transport === 'native_dsd' ||
    engine?.dsd_transport === 'dop' ||
    engine?.backend === 'asio' ||
    /ASIO Native DSD/i.test(engine?.output_mode || '')
  ) {
    return false;
  }

  // Advanced Native DSD / DoP never feeds DSP for DSD. Disable before play
  // so the button matches the selected mode. PCM on Shared still re-enables
  // above once the engine reports that path.
  if (settings?.playback_mode === 'advanced') {
    if (settings.audio_backend === 'asio' || settings.dsd_output_mode === 'native_dsd') {
      return false;
    }
    if (settings.dsd_output_mode === 'dop' && settings.audio_backend === 'wasapi_exclusive') {
      return false;
    }
  }

  return true;
}

export interface AdvancedOptionGating {
  asioBackendDisabled: boolean;
  nativeDsdDisabled: boolean;
  dopDisabled: boolean;
  exclusiveBackendDisabled: boolean;
}

/** Which Advanced-mode options must be disabled given the probed capabilities. */
export function getAdvancedOptionGating(
  capabilities:
    | Pick<
        AudioCapabilities,
        'asio_drivers_present' | 'native_dsd_supported' | 'dop_supported' | 'exclusive_mode_supported'
      >
    | null
    | undefined
): AdvancedOptionGating {
  const nativeDsdDisabled = capabilities?.native_dsd_supported !== true;
  return {
    // ASIO in this app is Native DSD only. A generic ASIO driver (ASIO4ALL,
    // Realtek, …) must not unlock the backend dropdown.
    asioBackendDisabled: nativeDsdDisabled,
    nativeDsdDisabled,
    dopDisabled:
      capabilities?.dop_supported !== true || capabilities?.exclusive_mode_supported === false,
    exclusiveBackendDisabled: capabilities?.exclusive_mode_supported === false,
  };
}

/**
 * When the output device changes, drop Advanced choices the new endpoint
 * cannot do so the dropdowns match the live engine instead of staying stuck.
 */
export function coerceUnavailableAudioOptions(
  settings: AppSettings,
  capabilities:
    | Pick<AudioCapabilities, 'native_dsd_supported' | 'dop_supported' | 'exclusive_mode_supported'>
    | null
    | undefined
): AppSettings {
  const normalized = normalizeAudioSettings(settings);
  if (!capabilities || normalized.playback_mode !== 'advanced') {
    return normalized;
  }

  let backend: AudioBackend = normalized.audio_backend;
  let dsdOutputMode: DsdOutputMode = normalized.dsd_output_mode;

  if (backend === 'asio' && capabilities.native_dsd_supported !== true) {
    backend = capabilities.exclusive_mode_supported === false ? 'shared' : 'wasapi_exclusive';
  } else if (backend === 'wasapi_exclusive' && capabilities.exclusive_mode_supported === false) {
    backend = 'shared';
  }

  if (dsdOutputMode === 'native_dsd' && capabilities.native_dsd_supported !== true) {
    dsdOutputMode = capabilities.dop_supported === true && capabilities.exclusive_mode_supported !== false
      ? 'dop'
      : 'pcm';
  } else if (dsdOutputMode === 'dop' && (capabilities.dop_supported !== true || capabilities.exclusive_mode_supported === false)) {
    dsdOutputMode = 'pcm';
  }

  if (backend === 'asio') {
    dsdOutputMode = 'native_dsd';
  } else if (dsdOutputMode === 'dop') {
    backend = 'wasapi_exclusive';
  }

  return normalizeAudioSettings({
    ...normalized,
    audio_backend: backend,
    dsd_output_mode: dsdOutputMode,
  });
}

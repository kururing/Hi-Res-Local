import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isWasapiExclusiveMode,
  normalizeWasapiExclusiveSettings,
  withWasapiExclusiveMode,
} from '../types/settings';

describe('Bit-Perfect WASAPI Exclusive mode', () => {
  it('defaults Exclusive and Bit-Perfect off', () => {
    expect(DEFAULT_SETTINGS.wasapi_exclusive).toBe(false);
    expect(DEFAULT_SETTINGS.bit_perfect).toBe(false);
    expect(isWasapiExclusiveMode(DEFAULT_SETTINGS)).toBe(false);
  });

  it('uses a stable default device id sentinel', () => {
    expect(DEFAULT_SETTINGS.output_device).toBe('default');
  });

  it('requires Exclusive and Bit-Perfect together', () => {
    expect(isWasapiExclusiveMode({ wasapi_exclusive: true, bit_perfect: false })).toBe(false);
    expect(isWasapiExclusiveMode({ wasapi_exclusive: false, bit_perfect: true })).toBe(false);
    expect(isWasapiExclusiveMode({ wasapi_exclusive: true, bit_perfect: true })).toBe(true);
  });

  it('toggles Exclusive and Bit-Perfect atomically', () => {
    expect(withWasapiExclusiveMode(true)).toEqual({
      wasapi_exclusive: true,
      bit_perfect: true,
    });
    expect(withWasapiExclusiveMode(false)).toEqual({
      wasapi_exclusive: false,
      bit_perfect: false,
    });
  });

  it('keeps a valid combined mode enabled', () => {
    const normalized = normalizeWasapiExclusiveSettings({
      ...DEFAULT_SETTINGS,
      wasapi_exclusive: true,
      bit_perfect: true,
    });
    expect(normalized.wasapi_exclusive).toBe(true);
    expect(normalized.bit_perfect).toBe(true);
    expect(isWasapiExclusiveMode(normalized)).toBe(true);
  });

  it('clears partial persisted modes', () => {
    const normalized = normalizeWasapiExclusiveSettings({
      ...DEFAULT_SETTINGS,
      wasapi_exclusive: true,
      bit_perfect: false,
    });
    expect(normalized.wasapi_exclusive).toBe(false);
    expect(normalized.bit_perfect).toBe(false);
  });
});

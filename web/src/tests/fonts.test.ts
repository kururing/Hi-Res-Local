import { describe, expect, it } from 'vitest';
import {
  APP_FONT_OPTIONS,
  getAppFontOption,
  getAppFontStacks,
  normalizeAppFont,
} from '../services/fonts';
import { DEFAULT_SETTINGS } from '../types/settings';

describe('interface fonts', () => {
  it('keeps Poppins as the compatible default', () => {
    expect(DEFAULT_SETTINGS.font_family).toBe('poppins');
  });

  it('provides unique font choices with usable fallback stacks', () => {
    const ids = APP_FONT_OPTIONS.map(font => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(APP_FONT_OPTIONS.length).toBeGreaterThanOrEqual(5);
    APP_FONT_OPTIONS.forEach(font => expect(font.stack).toContain(','));
  });

  it('falls back safely for an invalid persisted value', () => {
    expect(getAppFontOption('missing' as never).id).toBe('poppins');
    expect(normalizeAppFont('missing')).toBe('poppins');
  });

  it('keeps Segoe UI Variable Display in the display stack for sans choices', () => {
    const stacks = getAppFontStacks('inter');
    expect(stacks.ui).toContain("'Inter'");
    expect(stacks.display).toContain("'Inter'");
    expect(stacks.display).toContain("'Segoe UI Variable Display'");
  });

  it('uses the same stack for system and serif choices', () => {
    expect(getAppFontStacks('system').ui).toBe(getAppFontStacks('system').display);
    expect(getAppFontStacks('lora').ui).toBe(getAppFontStacks('lora').display);
  });
});

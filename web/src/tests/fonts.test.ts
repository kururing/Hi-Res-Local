import { describe, expect, it } from 'vitest';
import { APP_FONT_OPTIONS, getAppFontOption } from '../services/fonts';
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
  });
});

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, AppTheme } from '../types/settings';
import { en } from '../i18n/en';
import { vi } from '../i18n/vi';

describe('Milk Pink Theme & Settings Compatibility', () => {
  it('preserves oled as default stored theme for compatibility', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('oled');
  });

  it('provides Milk Pink theme labels in English i18n', () => {
    expect(en.settings_theme_oled).toBe('Milk Pink (Default)');
    expect(en.settings_theme_midnight).toBe('Midnight Indigo');
    expect(en.settings_theme_slate).toBe('Obsidian Slate');
    expect(en.settings_theme_light).toBe('Clean Light');
  });

  it('provides Vietnamese Milk Pink theme labels in Vietnamese i18n', () => {
    expect(vi.settings_theme_oled).toContain('Hồng Sữa');
    expect(vi.settings_theme_midnight).toBe('Midnight Indigo');
    expect(vi.settings_theme_slate).toBe('Obsidian Slate');
    expect(vi.settings_theme_light).toBe('Sáng Thanh Lịch');
  });

  it('supports all defined AppTheme keys across translations', () => {
    const themes: AppTheme[] = ['oled', 'midnight', 'slate', 'light'];
    themes.forEach(themeKey => {
      const enKey = `settings_theme_${themeKey}` as keyof typeof en;
      const viKey = `settings_theme_${themeKey}` as keyof typeof vi;
      expect(en[enKey]).toBeDefined();
      expect(typeof en[enKey]).toBe('string');
      expect((en[enKey] as string).length).toBeGreaterThan(0);

      expect(vi[viKey]).toBeDefined();
      expect(typeof vi[viKey]).toBe('string');
      expect((vi[viKey] as string).length).toBeGreaterThan(0);
    });
  });
});

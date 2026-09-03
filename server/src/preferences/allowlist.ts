const PORTABLE_KEYS = [
  'language',
  'theme',
  'font_family',
  'eq_enabled',
  'eq_preset_id',
  'eq_custom_gains',
  'artwork_adaptive_theme',
  'custom_theme_blur',
  'custom_theme_blur_percent',
] as const;

export type PortablePreferenceKey = (typeof PORTABLE_KEYS)[number];

const LANGUAGE = new Set(['vi', 'en']);
const THEME = new Set(['oled', 'midnight', 'slate', 'light', 'custom']);
const FONT = new Set(['poppins', 'inter', 'manrope', 'nunito', 'lora', 'system']);

export const PREFERENCES_SCHEMA_VERSION = 1;

export function sanitizePreferences(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input == null || Array.isArray(input)) {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof raw.language === 'string' && LANGUAGE.has(raw.language)) out.language = raw.language;
  if (typeof raw.theme === 'string' && THEME.has(raw.theme)) out.theme = raw.theme;
  if (typeof raw.font_family === 'string' && FONT.has(raw.font_family)) out.font_family = raw.font_family;
  if (typeof raw.eq_enabled === 'boolean') out.eq_enabled = raw.eq_enabled;
  if (typeof raw.eq_preset_id === 'string' && raw.eq_preset_id.length > 0 && raw.eq_preset_id.length <= 64) {
    out.eq_preset_id = raw.eq_preset_id;
  }
  if (Array.isArray(raw.eq_custom_gains) && raw.eq_custom_gains.length === 10
    && raw.eq_custom_gains.every((gain) => typeof gain === 'number' && Number.isFinite(gain) && gain >= -12 && gain <= 12)
  ) {
    out.eq_custom_gains = raw.eq_custom_gains;
  }
  if (typeof raw.artwork_adaptive_theme === 'boolean') out.artwork_adaptive_theme = raw.artwork_adaptive_theme;
  if (typeof raw.custom_theme_blur === 'boolean') out.custom_theme_blur = raw.custom_theme_blur;
  if (typeof raw.custom_theme_blur_percent === 'number'
    && Number.isFinite(raw.custom_theme_blur_percent)
    && raw.custom_theme_blur_percent >= 0
    && raw.custom_theme_blur_percent <= 100
  ) {
    out.custom_theme_blur_percent = raw.custom_theme_blur_percent;
  }

  return out;
}

import type { AppFont } from '../types/settings';

export interface AppFontOption {
  id: AppFont;
  label: string;
  stack: string;
}

export const APP_FONT_OPTIONS: readonly AppFontOption[] = [
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', 'Segoe UI', sans-serif" },
  { id: 'inter', label: 'Inter', stack: "'Inter', 'Segoe UI', sans-serif" },
  { id: 'manrope', label: 'Manrope', stack: "'Manrope', 'Segoe UI', sans-serif" },
  { id: 'nunito', label: 'Nunito', stack: "'Nunito', 'Segoe UI', sans-serif" },
  { id: 'lora', label: 'Lora', stack: "'Lora', Georgia, serif" },
  {
    id: 'system',
    label: 'System UI',
    stack: "'Segoe UI Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  },
];

const DISPLAY_FALLBACK_STACK = "'Segoe UI Variable Display', 'Segoe UI', sans-serif";

export function getAppFontOption(font: AppFont): AppFontOption {
  return APP_FONT_OPTIONS.find(option => option.id === font) ?? APP_FONT_OPTIONS[0];
}

export function normalizeAppFont(font: string | undefined): AppFont {
  if (font && APP_FONT_OPTIONS.some(option => option.id === font)) {
    return font as AppFont;
  }
  return APP_FONT_OPTIONS[0].id;
}

/** UI body stack and heading display stack (display keeps Segoe UI Variable for sans choices). */
export function getAppFontStacks(font: AppFont): { ui: string; display: string } {
  const option = getAppFontOption(font);
  if (option.id === 'system' || option.id === 'lora') {
    return { ui: option.stack, display: option.stack };
  }

  const primaryFamily = option.stack.split(',')[0]?.trim() ?? "'Poppins'";
  return {
    ui: option.stack,
    display: `${primaryFamily}, ${DISPLAY_FALLBACK_STACK}`,
  };
}

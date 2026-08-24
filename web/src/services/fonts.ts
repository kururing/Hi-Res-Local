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

export function getAppFontOption(font: AppFont): AppFontOption {
  return APP_FONT_OPTIONS.find(option => option.id === font) ?? APP_FONT_OPTIONS[0];
}

import type { AppFont } from './types/settings';

const loadedFonts = new Set<AppFont>();

/** Load only the selected interface font (CSP-safe self-hosted @fontsource bundles). */
export async function loadAppFont(font: AppFont): Promise<void> {
  if (font === 'system' || loadedFonts.has(font)) return;

  switch (font) {
    case 'poppins':
      await import('./fonts/poppins');
      break;
    case 'inter':
      await import('./fonts/inter');
      break;
    case 'manrope':
      await import('./fonts/manrope');
      break;
    case 'nunito':
      await import('./fonts/nunito');
      break;
    case 'lora':
      await import('./fonts/lora');
      break;
  }

  loadedFonts.add(font);
}

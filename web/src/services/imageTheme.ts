import { CustomImageTheme } from '../types/settings';

type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, amount: number): RGB => a.map(
  (channel, index) => Math.round(channel + (b[index] - channel) * amount)
) as RGB;

const cssRgb = (color: RGB): string => color.join(' ');

const createThemeBorder = (card: RGB, accent: RGB, foreground: RGB, dark: boolean): string => {
  const neutralBorder = mix(card, foreground, dark ? 0.22 : 0.16);
  return cssRgb(mix(neutralBorder, accent, dark ? 0.18 : 0.12));
};

export const getImageThemeBorderColor = (theme: CustomImageTheme): string => createThemeBorder(
  theme.colors.card.split(' ').map(Number) as RGB,
  theme.colors.accent.split(' ').map(Number) as RGB,
  theme.colors.foreground.split(' ').map(Number) as RGB,
  theme.is_dark
);

const luminance = ([r, g, b]: RGB): number => {
  const linear = [r, g, b].map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

const saturation = ([r, g, b]: RGB): number => Math.max(r, g, b) - Math.min(r, g, b);

const loadImage = (input: File | string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const isFile = input instanceof File;
  const url = isFile ? URL.createObjectURL(input) : input;
  const image = new Image();
  if (!isFile && /^https?:\/\//i.test(url)) image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (isFile) URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    if (isFile) URL.revokeObjectURL(url);
    reject(new Error('Unable to decode image'));
  };
  image.src = url;
});

const createStoredImage = (image: HTMLImageElement): string => {
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
};

const extractColors = (image: HTMLImageElement): { dominant: RGB; accent: RGB; palette: RGB[] } => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable');
  context.drawImage(image, 0, 0, 64, 64);

  const pixels = context.getImageData(0, 0, 64, 64).data;
  const buckets = new Map<string, { count: number; sum: RGB }>();
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 180) continue;
    const color: RGB = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const key = color.map(channel => Math.round(channel / 32)).join('-');
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bucket.count += 1;
    bucket.sum = bucket.sum.map((channel, i) => channel + color[i]) as RGB;
    buckets.set(key, bucket);
  }

  const colors = [...buckets.values()]
    .filter(bucket => bucket.count > 1)
    .map(bucket => ({
      count: bucket.count,
      color: bucket.sum.map(channel => Math.round(channel / bucket.count)) as RGB,
    }));
  if (!colors.length) throw new Error('No colors found');

  const byFrequency = [...colors].sort((a, b) => b.count - a.count);
  const dominant = byFrequency[0].color;
  const accent = colors
    .filter(item => luminance(item.color) > 0.08 && luminance(item.color) < 0.82)
    .sort((a, b) => (saturation(b.color) * Math.log2(b.count + 1)) - (saturation(a.color) * Math.log2(a.count + 1)))[0]?.color
    ?? dominant;
  const palette = [...colors]
    .sort((a, b) => ((b.count + 2) * (saturation(b.color) + 40)) - ((a.count + 2) * (saturation(a.color) + 40)))
    .map(item => item.color)
    .filter((color, index, list) => list.findIndex(candidate => (
      Math.abs(candidate[0] - color[0]) + Math.abs(candidate[1] - color[1]) + Math.abs(candidate[2] - color[2]) < 70
    )) === index)
    .slice(0, 4);
  for (const fallback of [dominant, accent, mix(dominant, [255, 255, 255], 0.45), mix(dominant, [0, 0, 0], 0.35)] as RGB[]) {
    if (palette.length >= 4) break;
    if (!palette.some(color => Math.abs(color[0] - fallback[0]) + Math.abs(color[1] - fallback[1]) + Math.abs(color[2] - fallback[2]) < 45)) {
      palette.push(fallback);
    }
  }
  return { dominant, accent, palette: palette.slice(0, 4) };
};

export const applyImageThemeAccent = (theme: CustomImageTheme, index: number): CustomImageTheme => {
  const palette = theme.palette ?? [theme.colors.accent];
  const safeIndex = Math.max(0, Math.min(index, palette.length - 1));
  const chosen = palette[safeIndex].split(' ').map(Number) as RGB;
  const card = theme.colors.card.split(' ').map(Number) as RGB;
  const base = theme.colors.base.split(' ').map(Number) as RGB;
  const foreground = theme.colors.foreground.split(' ').map(Number) as RGB;
  const accent = mix(chosen, theme.is_dark ? [220, 218, 255] : [70, 35, 82], theme.is_dark ? 0.16 : 0.1);
  return {
    ...theme,
    selected_palette_index: safeIndex,
    colors: {
      ...theme.colors,
      hover: cssRgb(mix(card, accent, theme.is_dark ? 0.14 : 0.1)),
      active: cssRgb(mix(card, accent, theme.is_dark ? 0.24 : 0.2)),
      primary: cssRgb(mix(base, accent, 0.38)),
      secondary: cssRgb(mix(accent, card, 0.22)),
      accent: cssRgb(accent),
      accent_hover: cssRgb(mix(accent, theme.is_dark ? [255, 255, 255] : [0, 0, 0], 0.16)),
      border: createThemeBorder(card, accent, foreground, theme.is_dark),
    },
  };
};

const createThemeFromImage = (
  image: HTMLImageElement,
  name: string,
  imageDataUrl = createStoredImage(image)
): CustomImageTheme => {
  const { dominant, accent: sampledAccent, palette } = extractColors(image);
  const dark = luminance(dominant) < 0.32;
  const base = mix(dominant, dark ? [7, 8, 16] : [250, 247, 252], dark ? 0.78 : 0.86);
  const card = mix(dominant, dark ? [24, 25, 38] : [255, 255, 255], dark ? 0.7 : 0.91);
  const accent = mix(sampledAccent, dark ? [210, 205, 255] : [92, 45, 108], dark ? 0.22 : 0.12);
  const foreground: RGB = dark ? [248, 248, 252] : [40, 31, 45];

  const theme: CustomImageTheme = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `image-theme-${Date.now()}`,
    name,
    image_data_url: imageDataUrl,
    is_dark: dark,
    palette: palette.map(cssRgb),
    selected_palette_index: 0,
    colors: {
      base: cssRgb(base),
      card: cssRgb(card),
      hover: cssRgb(mix(card, accent, dark ? 0.14 : 0.1)),
      active: cssRgb(mix(card, accent, dark ? 0.24 : 0.2)),
      primary: cssRgb(mix(base, accent, 0.38)),
      secondary: cssRgb(mix(accent, card, 0.22)),
      accent: cssRgb(accent),
      accent_hover: cssRgb(mix(accent, dark ? [255, 255, 255] : [0, 0, 0], 0.16)),
      foreground: cssRgb(foreground),
      muted: dark ? '184 178 194' : '103 88 110',
      border: createThemeBorder(card, accent, foreground, dark),
    },
  };
  const initialIndex = Math.max(0, theme.palette?.findIndex(color => color === cssRgb(sampledAccent)) ?? 0);
  return applyImageThemeAccent(theme, initialIndex);
};

export const createImageTheme = async (file: File): Promise<CustomImageTheme> => {
  const image = await loadImage(file);
  return createThemeFromImage(image, file.name.replace(/\.[^.]+$/u, '') || 'Theme từ ảnh');
};

/** Creates an in-memory theme from the artwork of the currently playing track. */
export const createArtworkTheme = async (source: string, name: string): Promise<CustomImageTheme> => {
  const image = await loadImage(source);
  return createThemeFromImage(image, name || 'Now playing', source);
};

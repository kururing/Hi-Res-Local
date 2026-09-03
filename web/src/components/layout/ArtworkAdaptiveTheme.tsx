import { useEffect } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { usePlatform } from '../../platform';
import { createArtworkTheme } from '../../services/imageTheme';
import { resolveTrackArtworkSource } from '../../services/trackArtwork';
import type { CustomImageTheme } from '../../types/settings';

const colorProperties: Record<string, keyof CustomImageTheme['colors']> = {
  '--color-oled-base': 'base',
  '--color-oled-card': 'card',
  '--color-oled-hover': 'hover',
  '--color-oled-active': 'active',
  '--color-primary': 'primary',
  '--color-secondary': 'secondary',
  '--color-accent': 'accent',
  '--color-accent-hover': 'accent_hover',
  '--color-foreground': 'foreground',
  '--color-muted': 'muted',
  '--color-border': 'border',
};

/** Applies a transient theme without overwriting the user's saved theme choice. */
export const ArtworkAdaptiveTheme = () => {
  const { status } = usePlayer();
  const { settings } = useSettings();
  const { artworkAssets } = usePlatform();
  const track = status.current_track;

  useEffect(() => {
    if (!settings.artwork_adaptive_theme || !track) return;

    const root = document.documentElement;
    const previous = new Map<string, string>();
    const properties = [...Object.keys(colorProperties), '--custom-theme-image'];
    properties.forEach(property => previous.set(property, root.style.getPropertyValue(property)));
    const previousClasses = {
      dark: root.classList.contains('dark'),
      light: root.classList.contains('light'),
      artwork: root.classList.contains('theme-artwork'),
      midnight: root.classList.contains('theme-midnight'),
      slate: root.classList.contains('theme-slate'),
      custom: root.classList.contains('theme-custom'),
    };
    let cancelled = false;

    void resolveTrackArtworkSource(track, artworkAssets)
      .then(async source => {
        if (!source || cancelled) return;
        const theme = await createArtworkTheme(source, `${track.title} — ${track.artist}`);
        if (cancelled) return;

        Object.entries(colorProperties).forEach(([property, key]) => {
          root.style.setProperty(property, theme.colors[key]);
        });
        root.style.setProperty('--custom-theme-image', `url("${theme.image_data_url}")`);
        root.classList.remove('theme-midnight', 'theme-slate', 'theme-custom');
        root.classList.add('theme-artwork');
        root.classList.toggle('dark', theme.is_dark);
        root.classList.toggle('light', !theme.is_dark);
      })
      .catch(error => console.warn('Could not create an adaptive artwork theme', error));

    return () => {
      cancelled = true;
      properties.forEach(property => {
        const value = previous.get(property);
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      });
      root.classList.toggle('dark', previousClasses.dark);
      root.classList.toggle('light', previousClasses.light);
      root.classList.toggle('theme-artwork', previousClasses.artwork);
      root.classList.toggle('theme-midnight', previousClasses.midnight);
      root.classList.toggle('theme-slate', previousClasses.slate);
      root.classList.toggle('theme-custom', previousClasses.custom);
    };
  }, [
    settings.artwork_adaptive_theme,
    settings.custom_image_theme,
    settings.theme,
    track,
    artworkAssets,
  ]);

  return null;
};

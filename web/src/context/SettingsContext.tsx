import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppSettings, DEFAULT_SETTINGS, AppLanguage, AppTheme, isWasapiExclusiveMode, withWasapiExclusiveMode } from '../types/settings';
import { Storage } from '../services/storage';
import { IpcService, isTauri } from '../services/ipc';
import { EqualizerPreset } from '../types/audio';
import { getAppFontOption } from '../services/fonts';
import { getImageThemeBorderColor } from '../services/imageTheme';

export const DEFAULT_EQ_PRESETS: EqualizerPreset[] = [
  { id: 'flat', name: 'Flat / Neutral', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'rock', name: 'Rock & Metal', gains: [4.5, 3.0, 1.5, 0, -1.0, 1.0, 2.5, 4.0, 4.5, 3.5] },
  { id: 'pop', name: 'V-Pop & Pop', gains: [2.0, 3.5, 1.0, -0.5, -1.0, 0.5, 2.0, 3.0, 3.5, 2.5] },
  { id: 'classical', name: 'Classical & Symphony', gains: [3.5, 2.5, 1.5, 0, 0, 0, 1.5, 2.5, 3.5, 4.0] },
  { id: 'jazz', name: 'Jazz & Blues', gains: [2.5, 1.5, 0.5, 1.0, -0.5, -0.5, 1.0, 2.0, 3.0, 3.5] },
  { id: 'bass', name: 'Bass Boost (+6dB)', gains: [6.0, 5.0, 4.0, 2.5, 1.0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Vocal / Acoustic Boost', gains: [-1.0, -1.0, 0, 2.0, 4.0, 4.5, 3.0, 1.5, 0.5, 0] },
  { id: 'electronic', name: 'Electronic / EDM', gains: [5.5, 4.5, 2.0, 0, -1.5, 1.5, 3.0, 4.0, 4.5, 4.0] },
];

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setLanguage: (lang: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  eqPresets: EqualizerPreset[];
  saveCustomEqPreset: (name: string, gains: number[]) => void;
  deleteCustomEqPreset: (id: string) => void;
  applyEqPreset: (presetId: string) => void;
  addMusicFolder: (folder: string) => void;
  removeMusicFolder: (folder: string) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => Storage.getSettings());
  const [customEqPresets, setCustomEqPresets] = useState<EqualizerPreset[]>(() => Storage.getCustomEqPresets());

  useEffect(() => {
    if (!isTauri()) return;
    void IpcService.invoke('get_library_roots').then(roots => {
      const folders = roots.filter(root => root.is_active).map(root => root.path);
      setSettings(previous => {
        if (JSON.stringify(previous.music_folders) === JSON.stringify(folders)) return previous;
        const next = { ...previous, music_folders: folders };
        Storage.saveSettings(next);
        return next;
      });
    }).catch(error => console.warn('Failed to load library folders', error));
  }, []);

  // Apply Theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light', 'theme-midnight', 'theme-slate', 'theme-custom');
    const customProperties = [
      '--color-oled-base', '--color-oled-card', '--color-oled-hover', '--color-oled-active',
      '--color-primary', '--color-secondary', '--color-accent', '--color-accent-hover',
      '--color-foreground', '--color-muted', '--color-border', '--custom-theme-image',
    ];
    customProperties.forEach(property => root.style.removeProperty(property));

    if (settings.theme === 'custom' && settings.custom_image_theme) {
      const theme = settings.custom_image_theme;
      root.classList.add('theme-custom', theme.is_dark ? 'dark' : 'light');
      const colorProperties: Record<string, string> = {
        '--color-oled-base': theme.colors.base,
        '--color-oled-card': theme.colors.card,
        '--color-oled-hover': theme.colors.hover,
        '--color-oled-active': theme.colors.active,
        '--color-primary': theme.colors.primary,
        '--color-secondary': theme.colors.secondary,
        '--color-accent': theme.colors.accent,
        '--color-accent-hover': theme.colors.accent_hover,
        '--color-foreground': theme.colors.foreground,
        '--color-muted': theme.colors.muted,
        '--color-border': getImageThemeBorderColor(theme),
        '--custom-theme-image': `url("${theme.image_data_url}")`,
      };
      Object.entries(colorProperties).forEach(([property, value]) => root.style.setProperty(property, value));
    } else if (settings.theme === 'light') {
      root.classList.add('light');
    } else if (settings.theme === 'midnight') {
      root.classList.add('dark', 'theme-midnight');
    } else if (settings.theme === 'slate') {
      root.classList.add('dark', 'theme-slate');
    } else {
      root.classList.add('dark'); // OLED
    }
  }, [settings.theme, settings.custom_image_theme]);

  // Blur is shared by custom-image and now-playing artwork themes. Keep this
  // isolated so moving the slider never reapplies or swaps the background image.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--custom-theme-blur',
      settings.custom_theme_blur ? `${settings.custom_theme_blur_percent * 0.6}px` : '0px'
    );
  }, [settings.custom_theme_blur, settings.custom_theme_blur_percent]);

  // Apply the persisted typography choice without requiring an app restart.
  useEffect(() => {
    const selectedFont = getAppFontOption(settings.font_family);
    document.documentElement.style.setProperty('--font-ui', selectedFont.stack);
    document.documentElement.style.setProperty('--font-display', selectedFont.stack);
  }, [settings.font_family]);

  // Keep the player running in the system tray when the user closes the window.
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      return window.onCloseRequested(event => {
        if (settings.close_to_tray) {
          event.preventDefault();
          void window.hide();
        }
      });
    }).then(dispose => {
      if (disposed) dispose();
      else unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [settings.close_to_tray]);

  // Sync EQ with backend/audio engine
  useEffect(() => {
    const activeGains = settings.eq_preset_id === 'custom'
      ? settings.eq_custom_gains
      : (allPresets.find(p => p.id === settings.eq_preset_id)?.gains || DEFAULT_SETTINGS.eq_custom_gains);

    void IpcService.invoke('set_equalizer', {
      enabled: settings.eq_enabled,
      gains: activeGains,
    }).catch(error => console.error('Failed to apply equalizer settings', error));
  }, [settings.eq_enabled, settings.eq_preset_id, settings.eq_custom_gains]);

  // Restore persisted audio mode: device → Exclusive → Bit-Perfect.
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        await IpcService.invoke('set_audio_output_device', {
          deviceId: settings.output_device || 'default',
        });

        const wantExclusive = isWasapiExclusiveMode(settings);
        if (wantExclusive) {
          try {
            await IpcService.invoke('set_exclusive_mode', { enabled: true });
            await IpcService.invoke('set_bit_perfect', { enabled: true });
          } catch (error) {
            console.error('Failed to restore WASAPI Exclusive', error);
            try {
              await IpcService.invoke('set_exclusive_mode', { enabled: false });
            } catch (rollbackError) {
              console.error('Failed to roll back WASAPI Exclusive restore', rollbackError);
            }
            updateSettings(withWasapiExclusiveMode(false));
            return;
          }
        } else {
          await IpcService.invoke('set_bit_perfect', { enabled: false });
          await IpcService.invoke('set_exclusive_mode', { enabled: false });
        }

        await IpcService.invoke('set_crossfade', {
          duration_secs: settings.crossfade_duration,
        });
        await IpcService.invoke('set_replay_gain', {
          mode: settings.replay_gain_mode,
          preamp_db: settings.replay_gain_preamp,
          prevent_clipping: true,
        });
      } catch (error) {
        console.error('Failed to restore native audio mode', error);
        updateSettings(withWasapiExclusiveMode(false));
      }
    })();
    // Restore once from the initial persisted settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the persisted Exclusive switch aligned with the live engine.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void IpcService.listen('audio://exclusive_mode', payload => {
      if (disposed) return;
      if (!payload.enabled) {
        updateSettings(withWasapiExclusiveMode(false));
      }
    }).then(dispose => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPresets = [...DEFAULT_EQ_PRESETS, ...customEqPresets];

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      Storage.saveSettings(next);
      return next;
    });
  }, []);

  const setLanguage = (language: AppLanguage) => {
    updateSettings({ language });
  };

  const setTheme = (theme: AppTheme) => {
    updateSettings({ theme });
  };

  const saveCustomEqPreset = (name: string, gains: number[]) => {
    const newPreset: EqualizerPreset = {
      id: `custom-${Date.now()}`,
      name,
      gains: [...gains],
      is_custom: true,
    };
    const updated = [...customEqPresets, newPreset];
    setCustomEqPresets(updated);
    Storage.saveCustomEqPresets(updated);
    updateSettings({ eq_preset_id: newPreset.id, eq_custom_gains: gains });
  };

  const deleteCustomEqPreset = (id: string) => {
    const updated = customEqPresets.filter(p => p.id !== id);
    setCustomEqPresets(updated);
    Storage.saveCustomEqPresets(updated);
    if (settings.eq_preset_id === id) {
      updateSettings({ eq_preset_id: 'flat' });
    }
  };

  const applyEqPreset = (presetId: string) => {
    const target = allPresets.find(p => p.id === presetId);
    if (target) {
      updateSettings({
        eq_preset_id: presetId,
        eq_custom_gains: [...target.gains],
      });
    }
  };

  const addMusicFolder = (folder: string) => {
    if (!settings.music_folders.includes(folder)) {
      updateSettings({ music_folders: [...settings.music_folders, folder] });
    }
  };

  const removeMusicFolder = (folder: string) => {
    void IpcService.invoke('remove_library_root_by_path', { path: folder })
      .catch(error => console.warn('Failed to remove library folder', error));
    updateSettings({
      music_folders: settings.music_folders.filter(f => f !== folder),
    });
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        setLanguage,
        setTheme,
        eqPresets: allPresets,
        saveCustomEqPreset,
        deleteCustomEqPreset,
        applyEqPreset,
        addMusicFolder,
        removeMusicFolder,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

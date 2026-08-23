import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppSettings, DEFAULT_SETTINGS, AppLanguage, AppTheme } from '../types/settings';
import { Storage } from '../services/storage';
import { IpcService } from '../services/ipc';
import { EqualizerPreset } from '../types/audio';

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

  // Apply Theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light', 'theme-midnight', 'theme-slate');

    if (settings.theme === 'light') {
      root.classList.add('light');
    } else if (settings.theme === 'midnight') {
      root.classList.add('dark', 'theme-midnight');
    } else if (settings.theme === 'slate') {
      root.classList.add('dark', 'theme-slate');
    } else {
      root.classList.add('dark'); // OLED
    }
  }, [settings.theme]);

  // Sync EQ with backend/audio engine
  useEffect(() => {
    const activeGains = settings.eq_preset_id === 'custom'
      ? settings.eq_custom_gains
      : (allPresets.find(p => p.id === settings.eq_preset_id)?.gains || DEFAULT_SETTINGS.eq_custom_gains);

    IpcService.invoke('set_equalizer', {
      enabled: settings.eq_enabled,
      gains: activeGains,
    });
  }, [settings.eq_enabled, settings.eq_preset_id, settings.eq_custom_gains]);

  const allPresets = [...DEFAULT_EQ_PRESETS, ...customEqPresets];

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      Storage.saveSettings(next);
      return next;
    });
  };

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

import React, { useState, useEffect } from 'react';
import {
  Folder,
  FolderPlus,
  Trash2,
  FolderSync,
  Cpu,
  Sliders,
  Palette,
  Download,
  Upload,
  Sparkles,
} from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../common/Button';
import { Slider } from '../common/Slider';
import { Storage } from '../../services/storage';
import { IpcService } from '../../services/ipc';
import { AudioOutputDevice } from '../../types/audio';
import { t } from '../../i18n';

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    setLanguage,
    setTheme,
    removeMusicFolder,
  } = useSettings();

  const { scanDirectory, scanProgress } = useLibrary();
  const { setIsEqualizerOpen } = usePlayer();
  const { showToast } = useToast();

  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);

  useEffect(() => {
    (async () => {
      const devices = await IpcService.invoke('get_audio_output_devices');
      if (devices) setOutputDevices(devices);
    })();
  }, []);

  const handleExportBackup = () => {
    const backupJson = Storage.exportBackup();
    const blob = new Blob([backupJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NgheNhacProMax_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('toast_backup_exported', settings.language), 'success');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const content = evt.target?.result as string;
      if (content) {
        const success = Storage.importBackup(content);
        if (success) {
          showToast(t('toast_backup_imported', settings.language), 'success');
          setTimeout(() => window.location.reload(), 1000);
        } else {
          showToast('Import failed: invalid JSON format', 'error');
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-4xl mx-auto w-full select-none pb-20">
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
          {t('settings_title', settings.language)}
        </h1>
        <span className="text-xs text-brand-muted">
          Configure music library paths, bit-perfect audio engine, and user preferences
        </span>
      </div>

      {/* 1. Music Library Folders */}
      <section className="p-6 rounded-2xl bg-oled-card border border-brand-border space-y-4 shadow-card-elevated">
        <div className="flex items-center justify-between pb-3 border-b border-brand-border/60">
          <div className="flex items-center gap-2.5">
            <Folder className="w-5 h-5 text-brand-accent" />
            <h2 className="font-bold text-base font-display text-white">
              {t('settings_library_section', settings.language)}
            </h2>
          </div>
          <Button
            size="sm"
            variant="accent"
            icon={<FolderPlus className="w-4 h-4" />}
            onClick={() => scanDirectory()}
          >
            {t('btn_add_folder', settings.language)}
          </Button>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
            {t('settings_folders_list', settings.language)}
          </span>

          {settings.music_folders.length === 0 ? (
            <div className="p-4 rounded-xl bg-oled-base/60 border border-brand-border/40 text-xs text-brand-muted">
              No custom folders added yet. Default library folder is active.
            </div>
          ) : (
            <div className="space-y-1.5">
              {settings.music_folders.map(folder => (
                <div
                  key={folder}
                  className="flex items-center justify-between p-3 rounded-xl bg-oled-base/80 border border-brand-border text-xs"
                >
                  <span className="font-mono text-brand-foreground truncate pr-4">{folder}</span>
                  <button
                    onClick={() => removeMusicFolder(folder)}
                    className="p-1 rounded text-brand-muted hover:text-rose-400 focus-visible:outline-none"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_watch}
              onChange={e => updateSettings({ auto_watch: e.target.checked })}
              className="w-4 h-4 rounded bg-oled-base border-brand-border text-brand-accent focus:ring-0 cursor-pointer"
            />
            <span className="text-xs text-brand-foreground font-medium">
              {t('settings_auto_watch', settings.language)}
            </span>
          </label>

          <Button
            size="sm"
            variant="secondary"
            icon={<FolderSync className="w-3.5 h-3.5" />}
            onClick={() => scanDirectory()}
            disabled={scanProgress?.is_scanning}
          >
            {scanProgress?.is_scanning ? 'Scanning...' : t('settings_btn_rescan', settings.language)}
          </Button>
        </div>
      </section>

      {/* 2. Audio Engine & Hardware */}
      <section className="p-6 rounded-2xl bg-oled-card border border-brand-border space-y-5 shadow-card-elevated">
        <div className="flex items-center gap-2.5 pb-3 border-b border-brand-border/60">
          <Cpu className="w-5 h-5 text-indigo-400" />
          <h2 className="font-bold text-base font-display text-white">
            {t('settings_audio_section', settings.language)}
          </h2>
        </div>

        {/* Output Device */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
            {t('settings_output_device', settings.language)}
          </label>
          <select
            value={settings.output_device}
            onChange={e => updateSettings({ output_device: e.target.value })}
            className="bg-oled-base border border-brand-border rounded-xl px-4 py-2.5 text-xs sm:text-sm text-brand-foreground focus-visible:outline-none"
          >
            {outputDevices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* Bit Perfect Toggle */}
        <div className="p-4 rounded-xl bg-oled-base/60 border border-brand-border space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-brand-foreground">
                {t('settings_bit_perfect', settings.language)}
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.bit_perfect}
                onChange={e => updateSettings({ bit_perfect: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
            </label>
          </div>
          <p className="text-xs text-brand-muted leading-relaxed">
            {t('settings_bit_perfect_desc', settings.language)}
          </p>
        </div>

        {/* Crossfade */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-brand-muted uppercase tracking-wider">
              {t('settings_crossfade', settings.language)}
            </span>
            <span className="font-mono text-brand-accent font-bold">
              {settings.crossfade_duration}s
            </span>
          </div>
          <Slider
            value={settings.crossfade_duration}
            min={0}
            max={12}
            step={1}
            onChange={val => updateSettings({ crossfade_duration: val })}
            ariaLabel="Crossfade duration"
          />
        </div>

        {/* ReplayGain */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
              {t('settings_replay_gain', settings.language)}
            </label>
            <select
              value={settings.replay_gain_mode}
              onChange={e => updateSettings({ replay_gain_mode: e.target.value as 'off' | 'track' | 'album' })}
              className="bg-oled-base border border-brand-border rounded-xl px-3.5 py-2 text-xs text-brand-foreground"
            >
              <option value="off">Off (Disabled)</option>
              <option value="track">Track Gain (Per-song normalization)</option>
              <option value="album">Album Gain (Preserves album dynamics)</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-brand-muted uppercase tracking-wider">
                {t('settings_replay_gain_preamp', settings.language)}
              </span>
              <span className="font-mono text-brand-accent font-bold">
                {settings.replay_gain_preamp > 0 ? `+${settings.replay_gain_preamp}` : settings.replay_gain_preamp}dB
              </span>
            </div>
            <Slider
              value={settings.replay_gain_preamp}
              min={-12}
              max={12}
              step={0.5}
              onChange={val => updateSettings({ replay_gain_preamp: val })}
              ariaLabel="ReplayGain Preamp"
            />
          </div>
        </div>

        {/* Equalizer Shortcut Button */}
        <div className="flex items-center justify-between pt-2 border-t border-brand-border/60">
          <div className="flex items-center gap-2 text-xs text-brand-foreground font-medium">
            <Sliders className="w-4 h-4 text-brand-accent" />
            <span>10-Band Equalizer: {settings.eq_enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Sliders className="w-3.5 h-3.5" />}
            onClick={() => setIsEqualizerOpen(true)}
          >
            Open Equalizer
          </Button>
        </div>
      </section>

      {/* 3. Appearance & Language */}
      <section className="p-6 rounded-2xl bg-oled-card border border-brand-border space-y-5 shadow-card-elevated">
        <div className="flex items-center gap-2.5 pb-3 border-b border-brand-border/60">
          <Palette className="w-5 h-5 text-brand-accent" />
          <h2 className="font-bold text-base font-display text-white">
            {t('settings_interface_section', settings.language)}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Theme Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
              {t('settings_theme', settings.language)}
            </label>
            <select
              value={settings.theme}
              onChange={e => setTheme(e.target.value as 'oled' | 'midnight' | 'slate' | 'light')}
              className="bg-oled-base border border-brand-border rounded-xl px-3.5 py-2 text-xs sm:text-sm text-brand-foreground"
            >
              <option value="oled">{t('settings_theme_oled', settings.language)}</option>
              <option value="midnight">{t('settings_theme_midnight', settings.language)}</option>
              <option value="slate">{t('settings_theme_slate', settings.language)}</option>
              <option value="light">{t('settings_theme_light', settings.language)}</option>
            </select>
          </div>

          {/* Language Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
              {t('settings_language', settings.language)}
            </label>
            <select
              value={settings.language}
              onChange={e => setLanguage(e.target.value as 'vi' | 'en')}
              className="bg-oled-base border border-brand-border rounded-xl px-3.5 py-2 text-xs sm:text-sm text-brand-foreground"
            >
              <option value="vi">Tiếng Việt (Vietnamese)</option>
              <option value="en">English (US)</option>
            </select>
          </div>
        </div>
      </section>

      {/* 4. Backup & Restore */}
      <section className="p-6 rounded-2xl bg-oled-card border border-brand-border space-y-4 shadow-card-elevated">
        <div className="flex items-center gap-2.5 pb-3 border-b border-brand-border/60">
          <Download className="w-5 h-5 text-emerald-400" />
          <h2 className="font-bold text-base font-display text-white">
            {t('settings_backup_section', settings.language)}
          </h2>
        </div>

        <p className="text-xs text-brand-muted">
          Export your favorite tracks, custom playlists, EQ presets, listening history, and settings into a JSON backup file.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            size="md"
            variant="secondary"
            icon={<Download className="w-4 h-4" />}
            onClick={handleExportBackup}
          >
            {t('settings_btn_export_backup', settings.language)}
          </Button>

          <label className="inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus-visible:outline-none min-h-[44px] px-4 py-2 text-sm gap-2 bg-brand-primary text-white hover:bg-indigo-900 border border-brand-border cursor-pointer shadow-sm">
            <Upload className="w-4 h-4" />
            <span>{t('settings_btn_import_backup', settings.language)}</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportBackup}
              className="sr-only"
            />
          </label>
        </div>
      </section>
    </div>
  );
};

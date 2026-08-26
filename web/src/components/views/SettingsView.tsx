import React, { useState, useEffect, useRef } from 'react';
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
  Power,
  ImagePlus,
  LoaderCircle,
} from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../common/Button';
import { Storage } from '../../services/storage';
import { IpcService, isTauri } from '../../services/ipc';
import { AudioCapabilities, AudioOutputDevice } from '../../types/audio';
import { t } from '../../i18n';
import { applyImageThemeAccent, createImageTheme } from '../../services/imageTheme';
import { AppSettings, AppTheme, isWasapiExclusiveMode, withWasapiExclusiveMode } from '../../types/settings';
import { APP_FONT_OPTIONS } from '../../services/fonts';

interface SettingsSwitchProps {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}

const SettingsSwitch: React.FC<SettingsSwitchProps> = ({
  checked,
  disabled = false,
  loading = false,
  label,
  description,
  onChange,
}) => (
  <div className="flex min-h-[72px] items-center justify-between gap-6 py-4">
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-brand-foreground">{label}</h3>
      <p className="mt-1 text-xs leading-relaxed text-brand-muted">{description}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={loading}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-11 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-oled-card disabled:cursor-wait disabled:opacity-50"
    >
      {loading ? (
        <LoaderCircle className="h-5 w-5 animate-spin text-brand-accent motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={`relative h-6 w-11 rounded-full border transition-colors duration-200 motion-reduce:transition-none ${
            checked
              ? 'border-brand-accent bg-brand-accent'
              : 'border-brand-border bg-slate-700/80'
          }`}
        >
          <span
            className={`absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </span>
      )}
    </button>
  </div>
);

interface ImageThemeControlsProps {
  settings: AppSettings;
  isCreatingTheme: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onChooseImage: () => void;
  onSelectColor: (index: number) => void;
  onBlurChange: (enabled: boolean) => void;
  onBlurPercentChange: (percent: number) => void;
}

const ImageThemeControls: React.FC<ImageThemeControlsProps> = ({
  settings,
  isCreatingTheme,
  inputRef,
  onImageChange,
  onChooseImage,
  onSelectColor,
  onBlurChange,
  onBlurPercentChange,
}) => (
  <div className="rounded-2xl border border-brand-border/70 bg-oled-base/55 p-4 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {settings.custom_image_theme && (
        <img
          src={settings.custom_image_theme.image_data_url}
          alt={t('settings_image_theme_preview_alt', settings.language)}
          className="h-20 w-full shrink-0 rounded-xl object-cover sm:w-28"
        />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-brand-foreground">
          {t('settings_image_theme_title', settings.language)}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-brand-muted">
          {t('settings_image_theme_desc', settings.language)}
        </p>
        {settings.custom_image_theme && (
          <div className="mt-3 flex items-center gap-2" aria-label={t('settings_image_theme_colors', settings.language)}>
            {(settings.custom_image_theme.palette ?? [
              settings.custom_image_theme.colors.base,
              settings.custom_image_theme.colors.card,
              settings.custom_image_theme.colors.accent,
              settings.custom_image_theme.colors.foreground,
            ]).map((color, index) => (
              <button
                type="button"
                key={`${color}-${index}`}
                onClick={() => onSelectColor(index)}
                aria-label={`${t('settings_image_theme_color_choice', settings.language)} ${index + 1}`}
                aria-pressed={(settings.custom_image_theme?.selected_palette_index ?? 0) === index}
                className={`h-9 w-9 rounded-full border-2 p-1 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
                  (settings.custom_image_theme?.selected_palette_index ?? 0) === index
                    ? 'border-brand-foreground shadow-sm'
                    : 'border-transparent'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="block h-full w-full rounded-full border border-brand-border"
                  style={{ backgroundColor: `rgb(${color.replaceAll(' ', ', ')})` }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onImageChange}
          className="sr-only"
        />
        <button
          type="button"
          disabled={isCreatingTheme}
          onClick={onChooseImage}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-accent px-4 text-xs font-semibold text-oled-base transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-wait disabled:opacity-60"
        >
          {isCreatingTheme ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
          {t('settings_image_theme_import', settings.language)}
        </button>
      </div>
    </div>

    {settings.custom_image_theme && (
      <div className="mt-3 border-t border-brand-border/60">
        <SettingsSwitch
          checked={settings.custom_theme_blur}
          label={t('settings_image_theme_blur', settings.language)}
          description={t('settings_image_theme_blur_desc', settings.language)}
          onChange={onBlurChange}
        />
        {settings.custom_theme_blur && (
          <div className="pb-5" aria-labelledby="image-theme-blur-amount-label">
            <div className="mb-2 flex items-center justify-between gap-4">
              <label
                id="image-theme-blur-amount-label"
                htmlFor="image-theme-blur-amount"
                className="text-xs font-semibold text-brand-muted"
              >
                {t('settings_image_theme_blur_amount', settings.language)}
              </label>
              <span className="min-w-12 text-right text-xs font-semibold tabular-nums text-brand-accent">
                {settings.custom_theme_blur_percent}%
              </span>
            </div>
            <input
              id="image-theme-blur-amount"
              type="range"
              min="0"
              max="100"
              step="1"
              value={settings.custom_theme_blur_percent}
              onChange={event => onBlurPercentChange(Number(event.target.value))}
              className="w-full"
              aria-valuetext={`${settings.custom_theme_blur_percent}%`}
            />
          </div>
        )}
      </div>
    )}
  </div>
);

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    setLanguage,
    setTheme,
    removeMusicFolder,
  } = useSettings();

  const { scanDirectory, scanProgress } = useLibrary();
  const { setIsEqualizerOpen, engineStatus } = usePlayer();
  const { showToast } = useToast();

  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [audioCapabilities, setAudioCapabilities] = useState<AudioCapabilities | null>(null);
  const [isUpdatingAudio, setIsUpdatingAudio] = useState(false);
  const [isUpdatingStartup, setIsUpdatingStartup] = useState(false);
  const [isCreatingTheme, setIsCreatingTheme] = useState(false);
  const themeImageInputRef = useRef<HTMLInputElement>(null);

  const handleThemeImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsCreatingTheme(true);
    try {
      const customImageTheme = await createImageTheme(file);
      const existingThemes = settings.custom_image_themes.length > 0
        ? settings.custom_image_themes
        : settings.custom_image_theme
          ? [settings.custom_image_theme]
          : [];
      updateSettings({
        custom_image_theme: customImageTheme,
        custom_image_themes: [...existingThemes, customImageTheme],
        theme: 'custom',
      });
      showToast(t('toast_image_theme_applied', settings.language), 'success');
    } catch (error) {
      console.error('Failed to create image theme', error);
      showToast(t('toast_image_theme_failed', settings.language), 'error');
    } finally {
      setIsCreatingTheme(false);
    }
  };

  const selectImageThemeColor = (index: number) => {
    if (!settings.custom_image_theme) return;
    const updatedTheme = applyImageThemeAccent(settings.custom_image_theme, index);
    const updatedThemes = settings.custom_image_themes.map(theme =>
      theme.id === updatedTheme.id ? updatedTheme : theme
    );
    updateSettings({ custom_image_theme: updatedTheme, custom_image_themes: updatedThemes });
  };

  const handleThemeSelection = (value: string) => {
    if (value.startsWith('custom:')) {
      const id = value.slice('custom:'.length);
      const selected = settings.custom_image_themes.find(theme => theme.id === id);
      if (selected) updateSettings({ theme: 'custom', custom_image_theme: selected });
      return;
    }
    setTheme(value as AppTheme);
  };

  useEffect(() => {
    void (async () => {
      try {
        const devices = await IpcService.invoke('get_audio_output_devices');
        const withDefault =
          devices.some(d => d.id === 'default')
            ? devices
            : [
                {
                  id: 'default',
                  name: t('settings_output_device_default', settings.language),
                  is_default: true,
                  sample_rates: [44100, 48000],
                },
                ...devices,
              ];

        // Localize the backend "System default" sentinel label.
        const localized = withDefault.map(d =>
          d.id === 'default'
            ? { ...d, name: t('settings_output_device_default', settings.language) }
            : d
        );
        setOutputDevices(localized);

        // Migrate legacy friendly-name settings / stale ids onto a real option.
        const current = settings.output_device;
        const byId = localized.find(d => d.id === current);
        if (!byId && current && current !== 'default') {
          const byName = localized.find(d => d.name === current);
          if (byName) {
            updateSettings({ output_device: byName.id });
          } else {
            updateSettings({ output_device: 'default' });
          }
        }

        const capabilities = await IpcService.invoke('get_audio_capabilities');
        setAudioCapabilities(capabilities);
      } catch (error) {
        console.error('Failed to load audio devices', error);
        showToast(t('toast_audio_setting_failed', settings.language), 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.language, showToast]);

  const applyAudioSetting = async (
    action: () => Promise<void>,
    partial: Partial<typeof settings>
  ) => {
    setIsUpdatingAudio(true);
    try {
      await action();
      updateSettings(partial);
      showToast(t('toast_audio_setting_applied', settings.language), 'success');
    } catch (error) {
      console.error('Failed to apply audio setting', error);
      showToast(t('toast_audio_setting_failed', settings.language), 'error');
    } finally {
      setIsUpdatingAudio(false);
    }
  };

  useEffect(() => {
    if (!isTauri()) return;

    void import('@tauri-apps/plugin-autostart')
      .then(({ isEnabled }) => isEnabled())
      .then(enabled => {
        if (enabled !== settings.launch_on_startup) {
          updateSettings({ launch_on_startup: enabled });
        }
      })
      .catch(error => console.error('Failed to read startup setting', error));
    // Read the operating-system value once when this settings view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      audioCapabilities?.exclusive_mode_supported === false &&
      isWasapiExclusiveMode(settings)
    ) {
      void (async () => {
        try {
          await IpcService.invoke('set_bit_perfect', { enabled: false });
          await IpcService.invoke('set_exclusive_mode', { enabled: false });
        } catch (error) {
          console.error('Failed to clear unsupported WASAPI Exclusive setting', error);
        } finally {
          updateSettings(withWasapiExclusiveMode(false));
        }
      })();
    }
  }, [
    audioCapabilities?.exclusive_mode_supported,
    settings.bit_perfect,
    settings.wasapi_exclusive,
    updateSettings,
  ]);

  const wasapiExclusiveChecked =
    engineStatus && engineStatus.output_mode
      ? /exclusive/i.test(engineStatus.output_mode) && engineStatus.bit_perfect
      : isWasapiExclusiveMode(settings);

  // Keep persisted flags aligned with the live engine when status is available.
  useEffect(() => {
    if (!engineStatus?.output_mode) return;
    const liveOn = /exclusive/i.test(engineStatus.output_mode) && engineStatus.bit_perfect;
    if (liveOn !== isWasapiExclusiveMode(settings)) {
      updateSettings(withWasapiExclusiveMode(liveOn));
    }
  }, [engineStatus, settings, updateSettings]);

  const handleWasapiExclusiveChange = (enabled: boolean) => {
    void applyAudioSetting(
      async () => {
        if (enabled) {
          try {
            await IpcService.invoke('set_exclusive_mode', { enabled: true });
            await IpcService.invoke('set_bit_perfect', { enabled: true });
          } catch (error) {
            try {
              await IpcService.invoke('set_bit_perfect', { enabled: false });
              await IpcService.invoke('set_exclusive_mode', { enabled: false });
            } catch (rollbackError) {
              console.error('Failed to roll back WASAPI Exclusive enable', rollbackError);
            }
            throw error;
          }
        } else {
          await IpcService.invoke('set_bit_perfect', { enabled: false });
          await IpcService.invoke('set_exclusive_mode', { enabled: false });
        }
      },
      withWasapiExclusiveMode(enabled)
    );
  };

  const handleStartupChange = async (enabled: boolean) => {
    if (!isTauri()) {
      updateSettings({ launch_on_startup: enabled });
      return;
    }

    setIsUpdatingStartup(true);
    try {
      const autostart = await import('@tauri-apps/plugin-autostart');
      if (enabled) await autostart.enable();
      else await autostart.disable();
      updateSettings({ launch_on_startup: enabled });
    } catch (error) {
      console.error('Failed to update startup setting', error);
      showToast(t('toast_startup_update_failed', settings.language), 'error');
    } finally {
      setIsUpdatingStartup(false);
    }
  };

  const handleDiscordPresenceChange = (enabled: boolean) => {
    updateSettings({ discord_presence_enabled: enabled });
    showToast(
      t(enabled ? 'toast_discord_enabled' : 'toast_discord_disabled', settings.language),
      'success'
    );
  };

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
    <div className="view-page mx-auto w-full max-w-4xl space-y-8 p-6 select-none md:p-8">
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
            <h2 className="font-bold text-base font-display text-brand-foreground">
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
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-rose-400 focus-visible:outline-none"
                    aria-label={`Remove folder ${folder}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
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
          <Cpu className="w-5 h-5 text-brand-accent" />
          <h2 className="font-bold text-base font-display text-brand-foreground">
            {t('settings_audio_section', settings.language)}
          </h2>
        </div>

        {/* Output Device */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
            {t('settings_output_device', settings.language)}
          </label>
          <select
            value={
              outputDevices.some(d => d.id === settings.output_device)
                ? settings.output_device
                : 'default'
            }
            disabled={isUpdatingAudio || outputDevices.length === 0}
            onChange={e => {
              const deviceId = e.target.value;
              void applyAudioSetting(
                () => IpcService.invoke('set_audio_output_device', { device_id: deviceId }),
                { output_device: deviceId }
              );
            }}
            className="bg-oled-base border border-brand-border rounded-xl px-4 py-2.5 text-xs sm:text-sm text-brand-foreground focus-visible:outline-none"
          >
            {outputDevices.map(d => (
              <option key={d.id} value={d.id}>
                {d.id === 'default'
                  ? t('settings_output_device_default', settings.language)
                  : d.is_default
                    ? `${d.name} (${t('settings_output_device_default_badge', settings.language)})`
                    : d.name}
              </option>
            ))}
          </select>
        </div>

        {/* WASAPI Exclusive */}
        <div className="p-4 rounded-xl bg-oled-base/60 border border-brand-border space-y-2">
          <div className="flex items-center gap-2 border-b border-brand-border/60 pb-2">
            <Sparkles className="w-4 h-4 text-amber-400" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
              Windows Audio
            </span>
          </div>
          <p className="text-xs text-brand-muted px-0.5">
            {t('settings_output_mode', settings.language)}:{' '}
            <span className="font-semibold text-brand-foreground">
              {engineStatus?.output_mode ||
                (isWasapiExclusiveMode(settings)
                  ? t('settings_output_mode_exclusive', settings.language)
                  : t('settings_output_mode_shared', settings.language))}
            </span>
          </p>
          <SettingsSwitch
            checked={wasapiExclusiveChecked}
            disabled={isUpdatingAudio || audioCapabilities?.exclusive_mode_supported === false}
            loading={isUpdatingAudio}
            label={t('settings_bit_perfect_wasapi', settings.language)}
            description={t('settings_bit_perfect_wasapi_desc', settings.language)}
            onChange={handleWasapiExclusiveChange}
          />
          {audioCapabilities?.exclusive_mode_supported === false && (
            <p className="text-xs font-medium text-amber-500">
              {t('settings_bit_perfect_unavailable', settings.language)}
            </p>
          )}
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
          <h2 className="font-bold text-base font-display text-brand-foreground">
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
              value={settings.theme === 'custom' && settings.custom_image_theme?.id
                ? `custom:${settings.custom_image_theme.id}`
                : settings.theme}
              onChange={e => handleThemeSelection(e.target.value)}
              className="bg-oled-base border border-brand-border rounded-xl px-3.5 py-2 text-xs sm:text-sm text-brand-foreground"
            >
              <option value="oled">{t('settings_theme_oled', settings.language)}</option>
              <option value="midnight">{t('settings_theme_midnight', settings.language)}</option>
              <option value="slate">{t('settings_theme_slate', settings.language)}</option>
              <option value="light">{t('settings_theme_light', settings.language)}</option>
              {settings.custom_image_themes.map((theme, index) => (
                <option key={theme.id ?? index} value={`custom:${theme.id ?? index}`}>
                  {theme.name || `${t('settings_theme_custom', settings.language)} ${index + 1}`}
                </option>
              ))}
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

          {/* Font Selector */}
          <div className="flex flex-col gap-3 sm:col-span-2">
            <div>
              <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider">
                {t('settings_font', settings.language)}
              </span>
              <p className="mt-1 text-xs text-brand-muted">
                {t('settings_font_desc', settings.language)}
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label={t('settings_font', settings.language)}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {APP_FONT_OPTIONS.map(font => {
                const isSelected = settings.font_family === font.id;
                return (
                  <button
                    key={font.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => updateSettings({ font_family: font.id })}
                    style={{ fontFamily: font.stack }}
                    className={`min-h-[60px] rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
                      isSelected
                        ? 'border-brand-accent bg-brand-accent/10 text-brand-accent'
                        : 'border-brand-border bg-oled-base text-brand-foreground hover:bg-oled-hover'
                    }`}
                  >
                    <span className="block text-sm font-bold">{font.label}</span>
                    <span className="mt-0.5 block truncate text-xs opacity-75">
                      {t('settings_font_preview', settings.language)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <ImageThemeControls
          settings={settings}
          isCreatingTheme={isCreatingTheme}
          inputRef={themeImageInputRef}
          onImageChange={handleThemeImage}
          onChooseImage={() => themeImageInputRef.current?.click()}
          onSelectColor={selectImageThemeColor}
          onBlurChange={custom_theme_blur => updateSettings({ custom_theme_blur })}
          onBlurPercentChange={custom_theme_blur_percent => updateSettings({ custom_theme_blur_percent })}
        />
      </section>

      {/* 4. Desktop behavior */}
      <section className="rounded-2xl border border-brand-border bg-oled-card px-6 shadow-card-elevated">
        <div className="flex items-center gap-2.5 border-b border-brand-border/60 py-4">
          <Power className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          <h2 className="font-display text-base font-bold text-brand-foreground">
            {t('settings_behavior_section', settings.language)}
          </h2>
        </div>

        <div className="divide-y divide-brand-border/60">
          <SettingsSwitch
            checked={settings.launch_on_startup}
            disabled={isUpdatingStartup}
            loading={isUpdatingStartup}
            label={t('settings_startup', settings.language)}
            description={t('settings_startup_desc', settings.language)}
            onChange={handleStartupChange}
          />
          <SettingsSwitch
            checked={settings.close_to_tray}
            label={t('settings_close_to_tray', settings.language)}
            description={t('settings_close_to_tray_desc', settings.language)}
            onChange={close_to_tray => updateSettings({ close_to_tray })}
          />
          <SettingsSwitch
            checked={settings.discord_presence_enabled}
            label={t('settings_discord_presence', settings.language)}
            description={t('settings_discord_presence_desc', settings.language)}
            onChange={handleDiscordPresenceChange}
          />
        </div>

      </section>

      {/* 5. Backup & Restore */}
      <section className="p-6 rounded-2xl bg-oled-card border border-brand-border space-y-4 shadow-card-elevated">
        <div className="flex items-center gap-2.5 pb-3 border-b border-brand-border/60">
          <Download className="w-5 h-5 text-brand-accent" />
          <h2 className="font-bold text-base font-display text-brand-foreground">
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

          <label className="inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus-visible:outline-none min-h-[44px] px-4 py-2 text-sm gap-2 bg-brand-primary text-white hover:brightness-110 border border-brand-border cursor-pointer shadow-sm">
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

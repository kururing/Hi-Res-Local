import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  RefreshCw,
  X,
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
import { applyImageThemeAccent, createArtworkTheme, createImageTheme } from '../../services/imageTheme';
import { AppSettings, AppTheme, isWasapiExclusiveMode, withWasapiExclusiveMode } from '../../types/settings';
import { APP_FONT_OPTIONS } from '../../services/fonts';
import { clearArtworkCache, downloadArtwork, getCachedArtwork } from '../../services/remoteArtwork';
import { resolveTrackArtworkSource } from '../../services/trackArtwork';

interface ArtworkDownloadProgress {
  albumDone: number;
  albumTotal: number;
  artistDone: number;
  artistTotal: number;
  found: number;
}

const ArtworkProgressRow: React.FC<{ label: string; done: number; total: number }> = ({
  label,
  done,
  total,
}) => {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-medium text-brand-foreground">{label}</span>
        <span className="font-mono tabular-nums text-brand-muted">{done}/{total}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-oled-base"
      >
        <div className="h-full rounded-full bg-brand-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

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
  onAdaptiveThemeChange: (enabled: boolean) => void;
  canSaveCurrentTheme: boolean;
  onSaveCurrentTheme: () => void;
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
  onAdaptiveThemeChange,
  canSaveCurrentTheme,
  onSaveCurrentTheme,
  onBlurChange,
  onBlurPercentChange,
}) => (
  <div className="rounded-2xl border border-brand-border/70 bg-oled-base/55 p-4 sm:p-5">
    <div className="mb-4 border-b border-brand-border/60">
      <SettingsSwitch
        checked={settings.artwork_adaptive_theme}
        label={t('settings_artwork_theme', settings.language)}
        description={t('settings_artwork_theme_desc', settings.language)}
        onChange={onAdaptiveThemeChange}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <p className="text-xs text-brand-muted">
          {t('settings_artwork_save_desc', settings.language)}
        </p>
        <button
          type="button"
          disabled={!canSaveCurrentTheme || isCreatingTheme}
          onClick={onSaveCurrentTheme}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-brand-accent/50 px-3 text-xs font-semibold text-brand-accent transition-colors hover:bg-brand-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Palette className="h-4 w-4" aria-hidden="true" />
          {t('settings_artwork_save', settings.language)}
        </button>
      </div>
    </div>
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

    <fieldset className="mt-4 border-t border-brand-border/60 pt-4">
      <legend className="px-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
        {t('settings_shared_background_effect', settings.language)}
      </legend>
      <div>
        <SettingsSwitch
          checked={settings.custom_theme_blur}
          disabled={!settings.custom_image_theme && !settings.artwork_adaptive_theme}
          label={t('settings_image_theme_blur', settings.language)}
          description={t('settings_image_theme_blur_desc', settings.language)}
          onChange={onBlurChange}
        />
        {settings.custom_theme_blur && (settings.custom_image_theme || settings.artwork_adaptive_theme) && (
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
            <p className="mt-2 text-[11px] leading-relaxed text-brand-muted">
              {t('settings_image_theme_blur_hint', settings.language)}
            </p>
          </div>
        )}
      </div>
    </fieldset>
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

  const { scanDirectory, scanProgress, albums, artists } = useLibrary();
  const { status, setIsEqualizerOpen, engineStatus } = usePlayer();
  const { showToast } = useToast();

  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(true);
  const [audioCapabilities, setAudioCapabilities] = useState<AudioCapabilities | null>(null);
  const [isUpdatingAudio, setIsUpdatingAudio] = useState(false);
  const [isUpdatingStartup, setIsUpdatingStartup] = useState(false);
  const [isCreatingTheme, setIsCreatingTheme] = useState(false);
  const [isDownloadingArtwork, setIsDownloadingArtwork] = useState(false);
  const [artworkProgress, setArtworkProgress] = useState<ArtworkDownloadProgress | null>(null);
  const cancelArtworkDownloadRef = useRef(false);
  const artworkAbortControllerRef = useRef<AbortController | null>(null);
  const themeImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    cancelArtworkDownloadRef.current = true;
    artworkAbortControllerRef.current?.abort();
  }, []);

  const handleArtworkDownload = async (refreshAll = false) => {
    if (isDownloadingArtwork) return;
    if (!navigator.onLine) {
      showToast(t('toast_artwork_offline', settings.language), 'error');
      return;
    }

    if (refreshAll) clearArtworkCache();
    const albumTargets = refreshAll
      ? albums
      : albums.filter(album => !getCachedArtwork('album', album.artist, album.name));
    const artistTargets = refreshAll
      ? artists
      : artists.filter(artist => !getCachedArtwork('artist', artist.name));

    if (albumTargets.length === 0 && artistTargets.length === 0) {
      setArtworkProgress({
        albumDone: 0,
        albumTotal: 0,
        artistDone: 0,
        artistTotal: 0,
        found: 0,
      });
      showToast(t('toast_artwork_up_to_date', settings.language), 'success');
      return;
    }

    cancelArtworkDownloadRef.current = false;
    const artworkAbortController = new AbortController();
    artworkAbortControllerRef.current = artworkAbortController;
    setIsDownloadingArtwork(true);
    setArtworkProgress({
      albumDone: 0,
      albumTotal: albumTargets.length,
      artistDone: 0,
      artistTotal: artistTargets.length,
      found: 0,
    });

    let found = 0;
    try {
      const processInBatches = async <T,>(items: T[], worker: (item: T) => Promise<string | null>, onDone: () => void) => {
        // Keep network usage bounded while allowing independent artwork
        // lookups to progress together.
        const concurrency = 4;
        for (let offset = 0; offset < items.length && !cancelArtworkDownloadRef.current; offset += concurrency) {
          const batch = items.slice(offset, offset + concurrency);
          const results = await Promise.all(batch.map(item => worker(item)));
          results.forEach(source => { if (source) found += 1; onDone(); });
        }
      };

      await processInBatches(
        albumTargets,
        album => downloadArtwork('album', album.artist, album.name, artworkAbortController.signal),
        () => setArtworkProgress(previous => previous ? { ...previous, albumDone: previous.albumDone + 1, found } : previous)
      );
      await processInBatches(
        artistTargets,
        artist => downloadArtwork('artist', artist.name, undefined, artworkAbortController.signal),
        () => setArtworkProgress(previous => previous ? { ...previous, artistDone: previous.artistDone + 1, found } : previous)
      );

      showToast(
        t(
          cancelArtworkDownloadRef.current ? 'toast_artwork_cancelled' : 'toast_artwork_complete',
          settings.language,
          { count: found }
        ),
        cancelArtworkDownloadRef.current ? 'info' : 'success'
      );
    } finally {
      if (artworkAbortControllerRef.current === artworkAbortController) {
        artworkAbortControllerRef.current = null;
      }
      setIsDownloadingArtwork(false);
    }
  };

  const handleThemeImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsCreatingTheme(true);
    try {
      let customImageTheme = await createImageTheme(file);
      if (isTauri()) {
        const [{ convertFileSrc }, cachedPath] = await Promise.all([
          import('@tauri-apps/api/core'),
          IpcService.invoke('cache_image_data', { cacheKey: customImageTheme.id ?? `theme-${Date.now()}`, category: 'themes', dataUrl: customImageTheme.image_data_url }),
        ]);
        customImageTheme = { ...customImageTheme, image_data_url: convertFileSrc(cachedPath) };
      }
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

  const handleSaveCurrentArtworkTheme = async () => {
    const track = status.current_track;
    if (!track || isCreatingTheme) return;
    setIsCreatingTheme(true);
    try {
      const source = await resolveTrackArtworkSource(track);
      if (!source) throw new Error('Current track has no artwork');
      let savedTheme = await createArtworkTheme(source, `${track.title} — ${track.artist}`);
      if (isTauri() && savedTheme.image_data_url.startsWith('data:image/')) {
        const [{ convertFileSrc }, cachedPath] = await Promise.all([
          import('@tauri-apps/api/core'),
          IpcService.invoke('cache_image_data', { cacheKey: savedTheme.id ?? `theme-${Date.now()}`, category: 'themes', dataUrl: savedTheme.image_data_url }),
        ]);
        savedTheme = { ...savedTheme, image_data_url: convertFileSrc(cachedPath) };
      }
      const existingThemes = settings.custom_image_themes.length > 0
        ? settings.custom_image_themes
        : settings.custom_image_theme
          ? [settings.custom_image_theme]
          : [];
      updateSettings({
        custom_image_theme: savedTheme,
        custom_image_themes: [...existingThemes, savedTheme],
        theme: 'custom',
        artwork_adaptive_theme: false,
      });
      showToast(t('toast_artwork_theme_saved', settings.language), 'success');
    } catch (error) {
      console.error('Failed to save current artwork theme', error);
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

  const loadAudioDevices = useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      const devices = await IpcService.invoke('get_audio_output_devices');
      const withDefault = devices.some(d => d.id === 'default')
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

      const localized = withDefault.map(d =>
        d.id === 'default'
          ? { ...d, name: t('settings_output_device_default', settings.language) }
          : d
      );
      setOutputDevices(localized);

      // Convert legacy friendly-name selections to the stable endpoint id, but
      // keep a disconnected endpoint id so reconnecting it restores the choice.
      const current = settings.output_device;
      if (current && current !== 'default' && !localized.some(d => d.id === current)) {
        const byName = localized.find(d => d.name === current);
        if (byName) updateSettings({ output_device: byName.id });
      }
      setAudioCapabilities(await IpcService.invoke('get_audio_capabilities'));
    } catch (error) {
      console.error('Failed to load audio devices', error);
      showToast(t('toast_audio_setting_failed', settings.language), 'error');
    } finally {
      setIsLoadingDevices(false);
    }
  }, [settings.language, settings.output_device, showToast, updateSettings]);

  useEffect(() => {
    void loadAudioDevices();
  }, [loadAudioDevices]);

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
              {t('settings_no_custom_folders', settings.language)}
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
                    aria-label={t('settings_remove_folder', settings.language, { folder })}
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
              onChange={e => {
                const enabled = e.target.checked;
                updateSettings({ auto_watch: enabled });
                void IpcService.invoke('set_directory_watching', { enabled }).catch(error => {
                  console.error('Failed to update folder watching', error);
                  updateSettings({ auto_watch: !enabled });
                });
              }}
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
            {scanProgress?.is_scanning ? t('settings_scanning', settings.language) : t('settings_btn_rescan', settings.language)}
          </Button>
        </div>

        <div className="space-y-4 border-t border-brand-border/60 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-brand-accent" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-brand-foreground">
                  {t('settings_artwork_title', settings.language)}
                </h3>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-brand-muted">
                {t('settings_artwork_desc', settings.language)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-muted">
                {t('settings_artwork_artist_note', settings.language)}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              {isDownloadingArtwork ? (
                <Button
                  size="md"
                  variant="danger"
                  icon={<X className="h-4 w-4" />}
                  onClick={() => {
                    cancelArtworkDownloadRef.current = true;
                    artworkAbortControllerRef.current?.abort();
                  }}
                >
                  {t('settings_artwork_cancel', settings.language)}
                </Button>
              ) : (
                <>
                  <Button
                    size="md"
                    variant="accent"
                    icon={<Download className="h-4 w-4" />}
                    onClick={() => void handleArtworkDownload(false)}
                    disabled={albums.length === 0 && artists.length === 0}
                  >
                    {t('settings_artwork_download', settings.language)}
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClick={() => void handleArtworkDownload(true)}
                    disabled={albums.length === 0 && artists.length === 0}
                  >
                    {t('settings_artwork_refresh', settings.language)}
                  </Button>
                </>
              )}
            </div>
          </div>

          {artworkProgress && (
            <div
              className="grid gap-3 rounded-xl border border-brand-border/60 bg-oled-base/60 p-4 sm:grid-cols-2"
              aria-live="polite"
              aria-busy={isDownloadingArtwork}
            >
              <ArtworkProgressRow
                label={t('settings_artwork_albums', settings.language)}
                done={artworkProgress.albumDone}
                total={artworkProgress.albumTotal}
              />
              <ArtworkProgressRow
                label={t('settings_artwork_artists', settings.language)}
                done={artworkProgress.artistDone}
                total={artworkProgress.artistTotal}
              />
              <p className="text-xs text-brand-muted sm:col-span-2">
                {isDownloadingArtwork
                  ? t('settings_artwork_working', settings.language, { count: artworkProgress.found })
                  : t('settings_artwork_result', settings.language, { count: artworkProgress.found })}
              </p>
            </div>
          )}
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
          <div className="flex min-h-11 items-center justify-between gap-3">
            <label
              htmlFor="audio-output-device"
              className="text-xs font-semibold text-brand-muted uppercase tracking-wider"
            >
              {t('settings_output_device', settings.language)}
            </label>
            <button
              type="button"
              onClick={() => void loadAudioDevices()}
              disabled={isLoadingDevices || isUpdatingAudio}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-oled-hover hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-wait disabled:opacity-50"
              aria-label={t('settings_output_device_refresh', settings.language)}
              title={t('settings_output_device_refresh', settings.language)}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
          <div className="relative">
            <select
              id="audio-output-device"
              value={settings.output_device || 'default'}
              disabled={isUpdatingAudio || isLoadingDevices || outputDevices.length === 0}
              aria-busy={isUpdatingAudio || isLoadingDevices}
              onChange={e => {
                const deviceId = e.target.value;
                if (deviceId === settings.output_device) return;
                void applyAudioSetting(
                  () => IpcService.invoke('set_audio_output_device', { deviceId }),
                  { output_device: deviceId }
                );
              }}
              className="min-h-11 w-full appearance-none rounded-xl border border-brand-border bg-oled-base px-4 py-2.5 pr-11 text-xs text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-wait disabled:opacity-60 sm:text-sm"
            >
              {!outputDevices.some(d => d.id === settings.output_device) && settings.output_device !== 'default' && (
                <option value={settings.output_device} disabled>
                  {t('settings_output_device_unavailable', settings.language)}
                </option>
              )}
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
            {(isUpdatingAudio || isLoadingDevices) && (
              <LoaderCircle
                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand-accent motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
          </div>
          <p className="text-xs leading-relaxed text-brand-muted" aria-live="polite">
            {isUpdatingAudio
              ? t('settings_output_device_applying', settings.language)
              : t('settings_output_device_hint', settings.language)}
          </p>
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
            <span>{t('settings_equalizer_state', settings.language, { state: t(settings.eq_enabled ? 'settings_enabled' : 'settings_disabled', settings.language) })}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Sliders className="w-3.5 h-3.5" />}
            onClick={() => setIsEqualizerOpen(true)}
          >
            {t('settings_open_equalizer', settings.language)}
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
          onAdaptiveThemeChange={artwork_adaptive_theme => updateSettings({ artwork_adaptive_theme })}
          canSaveCurrentTheme={Boolean(status.current_track)}
          onSaveCurrentTheme={handleSaveCurrentArtworkTheme}
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

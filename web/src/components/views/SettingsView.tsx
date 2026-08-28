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
  Power,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  X,
  Wand2,
  Gem,
  Layers,
  SlidersHorizontal,
  BadgeCheck,
  Activity,
} from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../common/Button';
import { Storage } from '../../services/storage';
import { IpcService, isTauri } from '../../services/ipc';
import { AsioDriver, AudioBackend, AudioCapabilities, AudioOutputDevice, DsdOutputMode, DsdRate, PlaybackMode } from '../../types/audio';
import { localizeAudioError, t } from '../../i18n';
import { applyImageThemeAccent, createArtworkTheme, createImageTheme } from '../../services/imageTheme';
import { AppSettings, AppTheme, normalizeAudioSettings } from '../../types/settings';
import { engineSourceDisplay, engineTransportDisplay, getAdvancedOptionGating, coerceUnavailableAudioOptions, volumeControlLabel, isEqualizerAvailable } from '../../services/playbackDisplay';

function bytesToBase64(bytes: number[]): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}
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

const DSD_RATE_ORDER: DsdRate[] = ['dsd64', 'dsd128', 'dsd256', 'dsd512'];

const formatCapabilityRate = (rate?: number): string => {
  if (!rate) return '—';
  const khz = rate / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
};

const maxDsdRate = (rates?: DsdRate[]): string => {
  const max = DSD_RATE_ORDER.filter(rate => rates?.includes(rate)).at(-1);
  return max ? max.toUpperCase() : '—';
};

const formatChannelCapability = (channels: number, vi: boolean): string => {
  if (channels === 1) return vi ? 'Mono (1 kênh)' : 'Mono (1 channel)';
  if (channels === 2) return vi ? 'Stereo (2 kênh)' : 'Stereo (2 channels)';
  if (channels > 2) return vi ? `${channels} kênh` : `${channels} channels`;
  return vi ? 'Chưa xác định' : 'Unknown';
};

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
}) => {
  const [blurDraftPercent, setBlurDraftPercent] = useState(settings.custom_theme_blur_percent);
  const blurDraftRef = useRef(settings.custom_theme_blur_percent);
  const isAdjustingBlurRef = useRef(false);
  const blurAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (isAdjustingBlurRef.current) return;
    blurDraftRef.current = settings.custom_theme_blur_percent;
    setBlurDraftPercent(settings.custom_theme_blur_percent);
  }, [settings.custom_theme_blur_percent]);

  const applyBlurPreview = useCallback((percent: number) => {
    setBlurDraftPercent(percent);
    document.documentElement.style.setProperty(
      '--custom-theme-blur',
      settings.custom_theme_blur ? `${percent * 0.6}px` : '0px',
    );
  }, [settings.custom_theme_blur]);

  const previewBlurPercent = useCallback((percent: number) => {
    const nextPercent = Math.max(0, Math.min(100, Math.round(percent)));
    isAdjustingBlurRef.current = true;
    blurDraftRef.current = nextPercent;
    if (blurAnimationFrameRef.current !== null) return;
    blurAnimationFrameRef.current = window.requestAnimationFrame(() => {
      blurAnimationFrameRef.current = null;
      applyBlurPreview(blurDraftRef.current);
    });
  }, [applyBlurPreview]);

  const commitBlurPercent = useCallback(() => {
    if (!isAdjustingBlurRef.current) return;
    if (blurAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(blurAnimationFrameRef.current);
      blurAnimationFrameRef.current = null;
    }
    isAdjustingBlurRef.current = false;
    applyBlurPreview(blurDraftRef.current);
    onBlurPercentChange(blurDraftRef.current);
  }, [applyBlurPreview, onBlurPercentChange]);

  const cancelBlurPreview = useCallback(() => {
    if (blurAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(blurAnimationFrameRef.current);
      blurAnimationFrameRef.current = null;
    }
    isAdjustingBlurRef.current = false;
    blurDraftRef.current = settings.custom_theme_blur_percent;
    applyBlurPreview(settings.custom_theme_blur_percent);
  }, [applyBlurPreview, settings.custom_theme_blur_percent]);

  useEffect(() => () => {
    if (blurAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(blurAnimationFrameRef.current);
    }
  }, []);

  return (
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
                {blurDraftPercent}%
              </span>
            </div>
            <input
              id="image-theme-blur-amount"
              type="range"
              min="0"
              max="100"
              step="1"
              value={blurDraftPercent}
              onChange={event => previewBlurPercent(Number(event.target.value))}
              onPointerUp={commitBlurPercent}
              onPointerCancel={cancelBlurPreview}
              onKeyUp={commitBlurPercent}
              onBlur={commitBlurPercent}
              className="w-full"
              aria-valuetext={`${blurDraftPercent}%`}
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
};

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    setLanguage,
    setTheme,
    removeMusicFolder,
  } = useSettings();

  const { scanDirectory, rescanLibrary, scanProgress, albums, artists } = useLibrary();
  const { status, setIsEqualizerOpen, engineStatus } = usePlayer();
  const { showToast } = useToast();
  const eqAvailable = isEqualizerAvailable(engineStatus, settings);

  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(true);
  const [audioCapabilities, setAudioCapabilities] = useState<AudioCapabilities | null>(null);
  const [asioDrivers, setAsioDrivers] = useState<AsioDriver[]>([]);
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
        artist => {
          // A substantial album is a stronger identity hint than the artist
          // name alone when the catalogue contains multiple namesakes.
          const representativeAlbum = artist.albums.reduce(
            (best, album) => !best || album.track_count > best.track_count ? album : best,
            artist.albums[0]
          );
          return downloadArtwork(
            'artist',
            artist.name,
            undefined,
            artworkAbortController.signal,
            representativeAlbum?.name,
          );
        },
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
      setAsioDrivers(await IpcService.invoke('get_asio_drivers'));
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

  const vi = settings.language === 'vi';
  const advancedGating = getAdvancedOptionGating(audioCapabilities);

  // The mode owns the legacy flags: every change goes through the single
  // apply_playback_mode command and persists only when the engine accepted it.
  const handlePlaybackModeChange = (mode: PlaybackMode) => {
    if (mode === settings.playback_mode || isUpdatingAudio) return;
    const next = normalizeAudioSettings({ ...settings, playback_mode: mode });
    void applyAudioSetting(
      async () => {
        await IpcService.invoke('apply_playback_mode', {
          mode,
          deviceId: settings.output_device || 'default',
          backend: mode === 'advanced' ? next.audio_backend : null,
          dsdTransport: mode === 'advanced' ? next.dsd_output_mode : null,
          asioDriverId: next.asio_driver_id,
        });
        setAudioCapabilities(await IpcService.invoke('get_audio_capabilities'));
      },
      {
        playback_mode: next.playback_mode,
        wasapi_exclusive: next.wasapi_exclusive,
        bit_perfect: next.bit_perfect,
        audio_backend: next.audio_backend,
        dsd_output_mode: next.dsd_output_mode,
      }
    );
  };

  const handleAdvancedOptionChange = (
    overrides: Partial<Pick<AppSettings, 'audio_backend' | 'dsd_output_mode' | 'asio_driver_id'>>
  ) => {
    const coupled: typeof overrides = { ...overrides };
    if (coupled.audio_backend === 'asio') {
      coupled.dsd_output_mode = 'native_dsd';
    }
    if (coupled.audio_backend === 'shared') {
      const transport = coupled.dsd_output_mode ?? settings.dsd_output_mode;
      if (transport === 'dop' || transport === 'native_dsd') {
        coupled.dsd_output_mode = 'pcm';
      }
    }
    if (coupled.dsd_output_mode === 'dop') {
      coupled.audio_backend = 'wasapi_exclusive';
    }
    if (coupled.dsd_output_mode === 'native_dsd') {
      coupled.audio_backend = 'asio';
    }
    const next = normalizeAudioSettings({ ...settings, ...coupled, playback_mode: 'advanced' });
    void applyAudioSetting(
      async () => {
        await IpcService.invoke('apply_playback_mode', {
          mode: 'advanced',
          deviceId: settings.output_device || 'default',
          backend: next.audio_backend,
          dsdTransport: next.dsd_output_mode,
          asioDriverId: next.asio_driver_id,
        });
        setAudioCapabilities(await IpcService.invoke('get_audio_capabilities'));
      },
      {
        playback_mode: 'advanced',
        audio_backend: next.audio_backend,
        dsd_output_mode: next.dsd_output_mode,
        asio_driver_id: next.asio_driver_id,
        wasapi_exclusive: next.wasapi_exclusive,
        bit_perfect: next.bit_perfect,
      }
    );
  };

  const handleOutputDeviceChange = (deviceId: string) => {
    if (deviceId === settings.output_device || isUpdatingAudio) return;
    void (async () => {
      setIsUpdatingAudio(true);
      let deviceSwitched = false;
      try {
        await IpcService.invoke('set_audio_output_device', { deviceId });
        deviceSwitched = true;
        const capabilities = await IpcService.invoke('get_audio_capabilities');
        setAudioCapabilities(capabilities);
        const next = coerceUnavailableAudioOptions(
          { ...settings, output_device: deviceId },
          capabilities
        );
        await IpcService.invoke('apply_playback_mode', {
          mode: next.playback_mode,
          deviceId,
          backend: next.playback_mode === 'advanced' ? next.audio_backend : null,
          dsdTransport: next.playback_mode === 'advanced' ? next.dsd_output_mode : null,
          asioDriverId: next.asio_driver_id,
        });
        updateSettings({
          output_device: deviceId,
          audio_backend: next.audio_backend,
          dsd_output_mode: next.dsd_output_mode,
          wasapi_exclusive: next.wasapi_exclusive,
          bit_perfect: next.bit_perfect,
        });
        showToast(t('toast_audio_setting_applied', settings.language), 'success');
      } catch (error) {
        console.error('Failed to switch audio device', error);
        if (deviceSwitched) {
          updateSettings({ output_device: deviceId });
          try {
            setAudioCapabilities(await IpcService.invoke('get_audio_capabilities'));
          } catch (capabilitiesError) {
            console.error('Failed to refresh audio capabilities after device switch', capabilitiesError);
          }
        }
        showToast(t('toast_audio_setting_failed', settings.language), 'error');
      } finally {
        setIsUpdatingAudio(false);
      }
    })();
  };

  const playbackModeOptions: {
    id: PlaybackMode;
    icon: typeof Wand2;
    label: string;
    desc: string;
  }[] = [
    {
      id: 'auto',
      icon: Wand2,
      label: vi ? 'Tự động (khuyến nghị)' : 'Automatic (recommended)',
      desc: vi
        ? 'Chọn đường âm thanh tốt nhất và tự hạ cấp an toàn khi cần.'
        : 'Picks the best audio path and falls back safely when needed.',
    },
    {
      id: 'high_quality',
      icon: Gem,
      label: vi ? 'Chất lượng cao' : 'High quality',
      desc: vi
        ? 'WASAPI Exclusive, bit-perfect khi có thể; DSD giải mã ra PCM. DoP chỉ bật trong Nâng cao.'
        : 'WASAPI Exclusive, bit-perfect when possible; DSD is decoded to PCM. DoP is Advanced-only.',
    },
    {
      id: 'multitask',
      icon: Layers,
      label: vi ? 'Đa nhiệm' : 'Multitasking',
      desc: vi
        ? 'WASAPI Shared, âm thanh chung với ứng dụng khác; DSD chuyển thành PCM.'
        : 'WASAPI Shared, audio mixes with other apps; DSD is converted to PCM.',
    },
    {
      id: 'advanced',
      icon: SlidersHorizontal,
      label: vi ? 'Nâng cao' : 'Advanced',
      desc: vi
        ? 'Tự chọn backend và DSD transport.'
        : 'Choose the backend and DSD transport yourself.',
    },
  ];

  const engineBackendLabel = engineStatus
    ? engineStatus.backend === 'asio'
      ? 'ASIO'
      : engineStatus.backend === 'wasapi_exclusive'
        ? 'WASAPI Exclusive'
        : engineStatus.backend === 'shared'
          ? 'WASAPI Shared'
          : engineStatus.output_mode || '—'
    : '—';

  const engineSourceLabel = engineSourceDisplay(engineStatus);

  const engineTransportLabel = engineTransportDisplay(engineStatus);

  const engineDeviceLabel = (() => {
    const selectedId = settings.output_device || 'default';
    if (selectedId !== 'default') {
      return outputDevices.find(device => device.id === selectedId)?.name
        || (vi ? 'Thiết bị đã chọn không khả dụng' : 'Selected device unavailable');
    }
    const windowsDefault = outputDevices.find(device => device.id !== 'default' && device.is_default);
    return windowsDefault?.name
      ? `${windowsDefault.name} (${vi ? 'mặc định Windows' : 'Windows default'})`
      : t('settings_output_device_default', settings.language);
  })();

  const selectedOutputDevice = settings.output_device && settings.output_device !== 'default'
    ? outputDevices.find(device => device.id === settings.output_device)
    : outputDevices.find(device => device.id !== 'default' && device.is_default)
      || outputDevices.find(device => device.id === 'default');
  const maxPcmRate = Math.max(0, ...(selectedOutputDevice?.sample_rates || []));
  const maxPcmDepth = Math.max(0, ...(selectedOutputDevice?.bit_depths || []));
  const maxChannels = Math.max(0, ...(selectedOutputDevice?.channels || []));
  const selectedAsioDriver = settings.asio_driver_id
    ? asioDrivers.find(driver => driver.id === settings.asio_driver_id)
    : undefined;
  const nativeDsdRates = selectedAsioDriver?.dsd_rates || audioCapabilities?.dsd_rates;

  const engineVolumeLabel = engineStatus
    ? `${Math.round((status.volume ?? engineStatus.volume ?? 1) * 100)}% (${volumeControlLabel(engineStatus.volume_control_kind)})`
    : '—';

  const asioDisabledReason = audioCapabilities?.asio_drivers_present
    ? (vi
        ? 'Driver ASIO không hỗ trợ Native DSD. ASIO trong app này chỉ dùng cho Native DSD.'
        : 'This ASIO driver does not support Native DSD. ASIO in this app is Native DSD only.')
    : (vi ? 'Không tìm thấy driver ASIO nào' : 'No ASIO driver found');
  const exclusiveDisabledReason = vi
    ? 'WASAPI Exclusive chưa khả dụng trên thiết bị này'
    : 'WASAPI Exclusive is not available on this device';
  const dopDisabledReason = vi
    ? 'DoP chưa khả dụng trên thiết bị này'
    : 'DoP is not available on this device';
  const nativeDsdDisabledReason = audioCapabilities?.asio_drivers_present
    ? (vi
        ? 'Driver ASIO không hỗ trợ Native DSD'
        : 'This ASIO driver does not support Native DSD')
    : (vi
        ? 'Không tìm thấy driver ASIO nào'
        : 'No ASIO driver found');

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

  const handleExportBackup = async () => {
    const database = await IpcService.invoke('export_database');
    const backupJson = JSON.stringify({
      ...JSON.parse(Storage.exportBackup()),
      database_base64: bytesToBase64(database),
    }, null, 2);
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
        let parsed: { database_base64?: string };
        try { parsed = JSON.parse(content); } catch { parsed = {}; }
        const databaseBytes = parsed.database_base64
          ? Uint8Array.from(atob(parsed.database_base64), char => char.charCodeAt(0))
          : null;
        const restore = databaseBytes
          ? IpcService.invoke('import_database', { data: [...databaseBytes] })
          : Promise.resolve();
        void restore.then(() => {
          const success = Storage.importBackup(content);
          if (success) {
            showToast(t('toast_backup_imported', settings.language), 'success');
            setTimeout(() => window.location.reload(), 1000);
          } else showToast('Import failed: invalid JSON format', 'error');
        }).catch(error => {
          console.error('Database restore failed', error);
          showToast('Import failed: database restore error', 'error');
        });
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
          {t('settings_subtitle', settings.language)}
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
                    onClick={() => void removeMusicFolder(folder)}
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
            onClick={() => void rescanLibrary()}
            disabled={scanProgress?.is_scanning || settings.music_folders.length === 0}
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
              onChange={e => handleOutputDeviceChange(e.target.value)}
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
          {!isLoadingDevices && selectedOutputDevice && (
            <section
              className="rounded-xl border border-brand-border/70 bg-oled-base/60 p-3"
              aria-label={vi ? 'Năng lực tối đa của DAC' : 'Maximum DAC capabilities'}
            >
              <div className="mb-3 flex items-start gap-2">
                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-brand-foreground">
                    {vi ? 'Năng lực DAC đã xác minh' : 'Verified DAC capabilities'}
                  </h3>
                  <p className="truncate text-xs leading-relaxed text-brand-muted" title={selectedOutputDevice.name}>
                    {selectedOutputDevice.name}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-brand-border/50 bg-oled-card/50 p-2.5">
                  <dt className="text-[11px] leading-relaxed text-brand-muted">
                    {vi ? 'Chất lượng PCM tối đa' : 'Maximum PCM quality'}
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold leading-relaxed text-brand-foreground">
                    {maxPcmDepth > 0 ? `${maxPcmDepth}-bit / ` : ''}{formatCapabilityRate(maxPcmRate)}
                  </dd>
                </div>
                <div className="rounded-lg border border-brand-border/50 bg-oled-card/50 p-2.5">
                  <dt className="text-[11px] leading-relaxed text-brand-muted">
                    {vi ? 'Kiểu âm thanh' : 'Speaker layout'}
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold leading-relaxed text-brand-foreground">
                    {formatChannelCapability(maxChannels, vi)}
                  </dd>
                </div>
                <div className="rounded-lg border border-brand-border/50 bg-oled-card/50 p-2.5">
                  <dt className="text-[11px] leading-relaxed text-brand-muted">
                    {vi ? 'DSD qua cổng DoP' : 'DSD over DoP'}
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold leading-relaxed text-brand-foreground">
                    {maxDsdRate(audioCapabilities?.dop_rates)}
                  </dd>
                </div>
                <div className="rounded-lg border border-brand-border/50 bg-oled-card/50 p-2.5">
                  <dt className="text-[11px] leading-relaxed text-brand-muted">
                    {vi ? 'DSD trực tiếp qua ASIO' : 'Native DSD over ASIO'}
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold leading-relaxed text-brand-foreground">
                    {maxDsdRate(nativeDsdRates)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-brand-muted">
                {vi
                  ? 'Dấu “—” nghĩa là thiết bị hoặc driver chưa xác nhận hỗ trợ. Các thông số được kiểm tra trực tiếp, không suy đoán từ tên DAC.'
                  : '“—” means support was not verified by the device or driver. Values are probed directly, not inferred from the DAC name.'}
              </p>
            </section>
          )}
        </div>

        {/* Playback mode */}
        <fieldset className="space-y-3" aria-busy={isUpdatingAudio}>
          <legend className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            {vi ? 'Chế độ phát nhạc' : 'Playback mode'}
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {playbackModeOptions.map(option => {
              const isSelected = settings.playback_mode === option.id;
              const Icon = option.icon;
              return (
                <label
                  key={option.id}
                  className={`flex min-h-[76px] items-start gap-3 rounded-xl border p-3 transition-colors ${
                    isSelected
                      ? 'border-brand-accent bg-brand-accent/10'
                      : 'border-brand-border bg-oled-base hover:bg-oled-hover'
                  } ${isUpdatingAudio ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="playback-mode"
                    value={option.id}
                    checked={isSelected}
                    disabled={isUpdatingAudio}
                    onChange={() => handlePlaybackModeChange(option.id)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer border-brand-border bg-oled-base text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-oled-card disabled:cursor-wait"
                  />
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${isSelected ? 'text-brand-accent' : 'text-brand-muted'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${isSelected ? 'text-brand-accent' : 'text-brand-foreground'}`}>
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-brand-muted">
                      {option.desc}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Advanced options (mode = advanced only) */}
        {settings.playback_mode === 'advanced' && (
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-brand-border bg-oled-base/60 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="audio-backend"
                className="text-xs font-semibold uppercase tracking-wider text-brand-muted"
              >
                Audio backend
              </label>
              <select
                id="audio-backend"
                value={settings.audio_backend}
                disabled={isUpdatingAudio}
                onChange={event => handleAdvancedOptionChange({ audio_backend: event.target.value as AudioBackend })}
                className="min-h-11 w-full rounded-xl border border-brand-border bg-oled-base px-4 py-2.5 text-xs text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60 sm:text-sm"
              >
                <option value="shared">WASAPI Shared</option>
                <option
                  value="wasapi_exclusive"
                  disabled={advancedGating.exclusiveBackendDisabled}
                  title={advancedGating.exclusiveBackendDisabled ? exclusiveDisabledReason : undefined}
                >
                  WASAPI Exclusive
                </option>
                <option value="asio" disabled={advancedGating.asioBackendDisabled} title={advancedGating.asioBackendDisabled ? asioDisabledReason : undefined}>
                  ASIO
                </option>
              </select>
              <p className="text-xs leading-relaxed text-brand-muted">
                {vi
                  ? 'ASIO chỉ phát Native DSD. File PCM (FLAC, MP3…) luôn đi WASAPI Shared, không phải Exclusive.'
                  : 'ASIO is Native DSD only. PCM files (FLAC, MP3…) always play through WASAPI Shared, not Exclusive.'}
              </p>
              {advancedGating.asioBackendDisabled && (
                <p className="text-xs leading-relaxed text-amber-500">{asioDisabledReason}</p>
              )}
              {advancedGating.exclusiveBackendDisabled && (
                <p className="text-xs leading-relaxed text-amber-500">{exclusiveDisabledReason}</p>
              )}

              <label
                htmlFor="asio-driver"
                className="block pt-2 text-xs font-semibold uppercase tracking-wider text-brand-muted"
              >
                ASIO driver
              </label>
              <select
                id="asio-driver"
                value={settings.asio_driver_id || ''}
                disabled={advancedGating.asioBackendDisabled || asioDrivers.length === 0 || isUpdatingAudio}
                title={advancedGating.asioBackendDisabled ? asioDisabledReason : undefined}
                onChange={event => handleAdvancedOptionChange({ asio_driver_id: event.target.value || null })}
                className="min-h-11 w-full rounded-xl border border-brand-border bg-oled-base px-4 py-2.5 text-xs text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60 sm:text-sm"
              >
                <option value="">Auto</option>
                {asioDrivers.map(driver => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
              {asioDrivers.length === 0 && (
                <p className="text-xs leading-relaxed text-brand-muted">
                  {vi
                    ? 'Chưa phát hiện ASIO driver. Driver DAC phải được cài riêng.'
                    : 'No ASIO driver detected. DAC drivers must be installed separately.'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="dsd-transport"
                className="text-xs font-semibold uppercase tracking-wider text-brand-muted"
              >
                DSD transport
              </label>
              <select
                id="dsd-transport"
                value={settings.dsd_output_mode}
                disabled={isUpdatingAudio}
                onChange={event => handleAdvancedOptionChange({ dsd_output_mode: event.target.value as DsdOutputMode })}
                className="min-h-11 w-full rounded-xl border border-brand-border bg-oled-base px-4 py-2.5 text-xs text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60 sm:text-sm"
              >
                <option value="native_dsd" disabled={advancedGating.nativeDsdDisabled} title={advancedGating.nativeDsdDisabled ? nativeDsdDisabledReason : undefined}>
                  Native DSD (ASIO)
                </option>
                <option value="dop" disabled={advancedGating.dopDisabled} title={advancedGating.dopDisabled ? dopDisabledReason : undefined}>
                  DoP (DSD over PCM)
                </option>
                <option value="pcm">DSD → PCM</option>
              </select>
              {advancedGating.nativeDsdDisabled && (
                <p className="text-xs leading-relaxed text-brand-muted">{nativeDsdDisabledReason}</p>
              )}
              {advancedGating.dopDisabled && (
                <p className="text-xs leading-relaxed text-brand-muted">{dopDisabledReason}</p>
              )}
              <p className="text-xs leading-relaxed text-brand-muted">
                {vi
                  ? 'DoP cần WASAPI Exclusive. Chọn Shared sẽ giải mã DSD thành PCM.'
                  : 'DoP requires WASAPI Exclusive. Shared decodes DSD to PCM.'}
              </p>
              <p className="pt-2 text-xs leading-relaxed text-brand-muted">
                EQ: {settings.eq_enabled ? (vi ? 'bật' : 'on') : (vi ? 'tắt' : 'off')}
                {' · '}
                ReplayGain: {settings.replay_gain_mode}
                {' · '}
                Crossfade: {settings.crossfade_duration > 0 ? `${settings.crossfade_duration}s` : (vi ? 'tắt' : 'off')}
              </p>
              {engineStatus?.native_dsd_error && (
                <p className="text-xs font-medium text-red-400" role="alert">
                  {localizeAudioError(engineStatus.native_dsd_error, settings.language)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Current engine status */}
        <div
          aria-live="polite"
          className="space-y-3 rounded-xl border border-brand-border bg-oled-base/60 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-border/60 pb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-brand-accent" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                {vi ? 'Trạng thái hiện tại' : 'Current status'}
              </span>
            </div>
            {engineStatus?.bit_perfect === true && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400"
                title={vi ? 'DSP (EQ, crossfade…) được bỏ qua' : 'DSP (EQ, crossfade…) is bypassed'}
              >
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {vi ? 'Bit-perfect tới driver' : 'Bit-perfect to driver'}
                <span className="font-normal text-emerald-400/80">
                  {vi ? '· DSP bỏ qua' : '· DSP bypassed'}
                </span>
              </span>
            )}
          </div>
          {engineStatus ? (
            <>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-brand-muted">Backend</dt>
                  <dd className="text-right font-semibold text-brand-foreground">{engineBackendLabel}</dd>
                </div>
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-brand-muted">{vi ? 'Thiết bị' : 'Device'}</dt>
                  <dd className="min-w-0 truncate text-right font-semibold text-brand-foreground" title={engineDeviceLabel}>
                    {engineDeviceLabel}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-brand-muted">{vi ? 'Định dạng nguồn' : 'Source format'}</dt>
                  <dd className="text-right font-semibold text-brand-foreground">{engineSourceLabel}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-brand-muted">{vi ? 'Đầu ra / Transport' : 'Output / Transport'}</dt>
                  <dd className="text-right font-semibold text-brand-foreground">{engineTransportLabel}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-brand-muted">{vi ? 'Âm lượng' : 'Volume'}</dt>
                  <dd className="text-right font-semibold text-brand-foreground">{engineVolumeLabel}</dd>
                </div>
              </dl>
              {engineStatus.fallback_reason && (
                <p className="text-[11px] leading-relaxed text-amber-500" role="status">
                  {engineStatus.fallback_reason}
                </p>
              )}
              {engineStatus.bit_perfect && (
                <p className="text-[11px] leading-relaxed text-brand-muted">
                  {vi
                    ? 'Đã xác minh luồng chính xác tới driver Windows; phần cứng hoặc driver vẫn có thể xử lý lại tín hiệu.'
                    : 'Exact stream verified to the Windows driver; the driver or hardware may still process the signal.'}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-brand-muted">
              {vi ? 'Chưa phát nhạc' : 'Not playing'}
            </p>
          )}
        </div>

        {/* Equalizer Shortcut Button */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-brand-border/60">
          <div className={`flex min-w-0 flex-col gap-0.5 ${!eqAvailable ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2 text-xs text-brand-foreground font-medium">
              <Sliders className={`w-4 h-4 ${eqAvailable ? 'text-brand-accent' : 'text-brand-muted'}`} />
              <span>{t('settings_equalizer_state', settings.language, { state: t(settings.eq_enabled ? 'settings_enabled' : 'settings_disabled', settings.language) })}</span>
            </div>
            {!eqAvailable && (
              <p className="pl-6 text-[11px] leading-relaxed text-brand-muted">
                {t('settings_equalizer_unavailable', settings.language)}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Sliders className="w-3.5 h-3.5" />}
            disabled={!eqAvailable}
            title={!eqAvailable ? t('settings_equalizer_unavailable', settings.language) : undefined}
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
          {t('settings_backup_description', settings.language)}
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

import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  Sliders,
  Heart,
  Disc3,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Wand2,
  Gem,
  Layers,
  SlidersHorizontal,
  Activity,
} from 'lucide-react';
import { usePlayer, usePlaybackProgress } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { Slider } from '../common/Slider';
import { TrackArtwork } from '../common/TrackArtwork';
import { t } from '../../i18n';
import { Artist } from '../../types/library';
import { formatQualityLabel } from '../../services/trackPresentation';
import {
  coerceUnavailableAudioOptions,
  engineSourceDisplay,
  engineTransportDisplay,
  getAdvancedOptionGating,
  isEqualizerAvailable,
  volumeControlLabel,
} from '../../services/playbackDisplay';
import { IpcService } from '../../services/ipc';
import {
  AsioDriver,
  AudioBackend,
  AudioCapabilities,
  AudioOutputDevice,
  DsdOutputMode,
  PlaybackMode,
} from '../../types/audio';
import { useToast } from '../../context/ToastContext';
import { AppSettings, normalizeAudioSettings } from '../../types/settings';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const VOLUME_COMMIT_INTERVAL_MS = 48;
const VOLUME_STATUS_SYNC_GRACE_MS = 200;
const SEEK_COMMIT_DELAY_MS = 120;
const SEEK_STATUS_SYNC_GRACE_MS = 300;

/**
 * The only part of the player bar that subscribes to the ~10Hz playback
 * progress ticker, so the rest of the bar does not re-render on every tick.
 */
const PlayerSeekBar: React.FC<{
  seek: (positionSecs: number) => Promise<void>;
  trackId: string | null;
}> = React.memo(
  ({ seek, trackId }) => {
    const { position, duration } = usePlaybackProgress();
    const [displayedPosition, setDisplayedPosition] = React.useState(position);
    const pendingSeekRef = React.useRef<number | null>(null);
    const seekCommitTimerRef = React.useRef<number | null>(null);
    const seekSyncBlockedUntilRef = React.useRef(0);

    const commitSeek = React.useCallback((value?: number) => {
      const nextPosition = value ?? pendingSeekRef.current;
      if (nextPosition === null) return;
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
        seekCommitTimerRef.current = null;
      }
      pendingSeekRef.current = null;
      seekSyncBlockedUntilRef.current = Date.now() + SEEK_STATUS_SYNC_GRACE_MS;
      void seek(nextPosition);
    }, [seek]);

    const queueSeek = React.useCallback((value: number) => {
      const nextPosition = Math.min(duration || 180, Math.max(0, value));
      pendingSeekRef.current = nextPosition;
      seekSyncBlockedUntilRef.current = Date.now() + SEEK_STATUS_SYNC_GRACE_MS;
      setDisplayedPosition(nextPosition);

      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
      seekCommitTimerRef.current = window.setTimeout(
        () => commitSeek(),
        SEEK_COMMIT_DELAY_MS,
      );
    }, [commitSeek, duration]);

    React.useEffect(() => {
      if (
        pendingSeekRef.current !== null ||
        Date.now() < seekSyncBlockedUntilRef.current
      ) return;
      setDisplayedPosition(position);
    }, [position]);

    React.useEffect(() => {
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
        seekCommitTimerRef.current = null;
      }
      pendingSeekRef.current = null;
      seekSyncBlockedUntilRef.current = 0;
      setDisplayedPosition(position);
    }, [trackId]);

    React.useEffect(() => () => {
      if (seekCommitTimerRef.current !== null) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
    }, []);

    return (
      <div className="w-full flex items-center gap-3 text-xs text-brand-muted">
        <span className="w-10 text-right font-mono text-[11px] tabular-nums">
          {formatTime(displayedPosition)}
        </span>
        <div className="flex-1">
          <Slider
            value={displayedPosition}
            max={duration || 180}
            step={1}
            onChange={queueSeek}
            onChangeEnd={commitSeek}
            ariaLabel="Playback seek"
            compact
          />
        </div>
        <span className="w-10 text-left font-mono text-[11px] tabular-nums">
          {formatTime(duration)}
        </span>
      </div>
    );
  }
);
PlayerSeekBar.displayName = 'PlayerSeekBar';

interface PlayerBarProps {
  isNowPlayingOpen?: boolean;
  onNavigateNowPlaying?: () => void;
  onNavigateArtist?: (artist: Artist) => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  isNowPlayingOpen = false,
  onNavigateNowPlaying,
  onNavigateArtist,
}) => {
  const {
    status,
    engineStatus,
    togglePlayPause,
    prev,
    next,
    seek,
    setVolume,
    toggleMute,
    setLoopMode,
    toggleShuffle,
    isQueueDrawerOpen,
    setIsQueueDrawerOpen,
    isEqualizerOpen,
    setIsEqualizerOpen,
    queue,
  } = usePlayer();

  const { toggleFavoriteTrack, favoriteTrackIds, artists } = useLibrary();
  const { settings, updateSettings } = useSettings();
  const { showToast } = useToast();
  const [isDevicePopupOpen, setIsDevicePopupOpen] = React.useState(false);
  const [outputDevices, setOutputDevices] = React.useState<AudioOutputDevice[]>([]);
  const [audioCapabilities, setAudioCapabilities] = React.useState<AudioCapabilities | null>(null);
  const [asioDrivers, setAsioDrivers] = React.useState<AsioDriver[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = React.useState(false);
  const [isSwitchingDevice, setIsSwitchingDevice] = React.useState(false);
  const devicePopupRef = React.useRef<HTMLDivElement>(null);
  const deviceButtonRef = React.useRef<HTMLButtonElement>(null);
  const initialDisplayedVolume = status.is_muted ? 0 : status.volume;
  const [displayedVolume, setDisplayedVolume] = React.useState(initialDisplayedVolume);
  const wheelVolumeRef = React.useRef(initialDisplayedVolume);
  const pendingVolumeRef = React.useRef<number | null>(null);
  const volumeCommitTimerRef = React.useRef<number | null>(null);
  const volumeSyncBlockedUntilRef = React.useRef(0);
  const eqAvailable = isEqualizerAvailable(engineStatus, settings);

  React.useEffect(() => {
    if (
      pendingVolumeRef.current !== null ||
      Date.now() < volumeSyncBlockedUntilRef.current
    ) return;
    const nextVolume = status.is_muted ? 0 : status.volume;
    wheelVolumeRef.current = nextVolume;
    setDisplayedVolume(nextVolume);
  }, [status.is_muted, status.volume]);

  const commitVolumeChange = React.useCallback((value?: number) => {
    const nextVolume = value ?? pendingVolumeRef.current;
    if (nextVolume === null) return;
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
      volumeCommitTimerRef.current = null;
    }
    pendingVolumeRef.current = null;
    void setVolume(nextVolume);
  }, [setVolume]);

  const queueVolumeChange = React.useCallback((value: number) => {
    const nextVolume = Math.min(1, Math.max(0, value));
    wheelVolumeRef.current = nextVolume;
    pendingVolumeRef.current = nextVolume;
    volumeSyncBlockedUntilRef.current = Date.now() + VOLUME_STATUS_SYNC_GRACE_MS;
    setDisplayedVolume(nextVolume);

    if (volumeCommitTimerRef.current === null) {
      volumeCommitTimerRef.current = window.setTimeout(
        () => commitVolumeChange(),
        VOLUME_COMMIT_INTERVAL_MS
      );
    }
  }, [commitVolumeChange]);

  React.useEffect(() => () => {
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
    }
  }, []);

  const handleVolumeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const direction = event.deltaY !== 0 ? -Math.sign(event.deltaY) : Math.sign(event.deltaX);
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const nextVolume = Math.min(1, Math.max(0, wheelVolumeRef.current + direction * 0.01));
    queueVolumeChange(nextVolume);
  };

  const loadOutputDevices = React.useCallback(async () => {
    setIsLoadingDevices(true);
    try {
      const [devices, capabilities, drivers] = await Promise.all([
        IpcService.invoke('get_audio_output_devices'),
        IpcService.invoke('get_audio_capabilities'),
        IpcService.invoke('get_asio_drivers'),
      ]);
      setAudioCapabilities(capabilities);
      setAsioDrivers(drivers);
      const withDefault = devices.some(device => device.id === 'default')
        ? devices
        : [{
            id: 'default',
            name: t('settings_output_device_default', settings.language),
            is_default: true,
          }, ...devices];
      setOutputDevices(withDefault.map(device => device.id === 'default'
        ? { ...device, name: t('settings_output_device_default', settings.language) }
        : device));
    } catch (error) {
      console.error('Failed to load quick audio devices', error);
      showToast(t('toast_audio_setting_failed', settings.language), 'error');
    } finally {
      setIsLoadingDevices(false);
    }
  }, [settings.language, showToast]);

  React.useEffect(() => {
    if (!isDevicePopupOpen) return;
    void loadOutputDevices();
    window.requestAnimationFrame(() => devicePopupRef.current?.focus());

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (devicePopupRef.current?.contains(target) || deviceButtonRef.current?.contains(target)) return;
      setIsDevicePopupOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsDevicePopupOpen(false);
      deviceButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isDevicePopupOpen, loadOutputDevices]);

  const switchOutputDevice = async (deviceId: string) => {
    if (deviceId === settings.output_device || isSwitchingDevice) return;
    setIsSwitchingDevice(true);
    let deviceSwitched = false;
    try {
      await IpcService.invoke('set_audio_output_device', { deviceId });
      deviceSwitched = true;
      const capabilities = await IpcService.invoke('get_audio_capabilities');
      setAudioCapabilities(capabilities);
      const next = coerceUnavailableAudioOptions({ ...settings, output_device: deviceId }, capabilities);
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
      console.error('Failed to switch quick audio device', error);
      if (deviceSwitched) {
        updateSettings({ output_device: deviceId });
      }
      showToast(t('toast_audio_setting_failed', settings.language), 'error');
    } finally {
      setIsSwitchingDevice(false);
    }
  };

  const applyPlaybackSettings = async (next: AppSettings) => {
    if (isSwitchingDevice) return;
    setIsSwitchingDevice(true);
    try {
      await IpcService.invoke('apply_playback_mode', {
        mode: next.playback_mode,
        deviceId: next.output_device || 'default',
        backend: next.playback_mode === 'advanced' ? next.audio_backend : null,
        dsdTransport: next.playback_mode === 'advanced' ? next.dsd_output_mode : null,
        asioDriverId: next.asio_driver_id,
      });
      updateSettings({
        playback_mode: next.playback_mode,
        audio_backend: next.audio_backend,
        dsd_output_mode: next.dsd_output_mode,
        asio_driver_id: next.asio_driver_id,
        wasapi_exclusive: next.wasapi_exclusive,
        bit_perfect: next.bit_perfect,
      });
      setAudioCapabilities(await IpcService.invoke('get_audio_capabilities'));
      showToast(t('toast_audio_setting_applied', settings.language), 'success');
    } catch (error) {
      console.error('Failed to apply quick playback settings', error);
      showToast(t('toast_audio_setting_failed', settings.language), 'error');
    } finally {
      setIsSwitchingDevice(false);
    }
  };

  const changePlaybackMode = (mode: PlaybackMode) => {
    if (mode === settings.playback_mode || isSwitchingDevice) return;
    void applyPlaybackSettings(normalizeAudioSettings({ ...settings, playback_mode: mode }));
  };

  const changeAdvancedOption = (
    overrides: Partial<Pick<AppSettings, 'audio_backend' | 'dsd_output_mode' | 'asio_driver_id'>>,
  ) => {
    if (isSwitchingDevice) return;
    const coupled = { ...overrides };
    if (coupled.audio_backend === 'asio') coupled.dsd_output_mode = 'native_dsd';
    if (coupled.audio_backend === 'shared') {
      const transport = coupled.dsd_output_mode ?? settings.dsd_output_mode;
      if (transport === 'dop' || transport === 'native_dsd') coupled.dsd_output_mode = 'pcm';
    }
    if (coupled.dsd_output_mode === 'dop') coupled.audio_backend = 'wasapi_exclusive';
    if (coupled.dsd_output_mode === 'native_dsd') coupled.audio_backend = 'asio';
    void applyPlaybackSettings(normalizeAudioSettings({
      ...settings,
      ...coupled,
      playback_mode: 'advanced',
    }));
  };

  const advancedGating = getAdvancedOptionGating(audioCapabilities);
  const playbackModeOptions: Array<{
    id: PlaybackMode;
    icon: typeof Wand2;
    label: string;
  }> = [
    { id: 'auto', icon: Wand2, label: t('quick_mode_auto', settings.language) },
    { id: 'high_quality', icon: Gem, label: t('quick_mode_quality', settings.language) },
    { id: 'multitask', icon: Layers, label: t('quick_mode_multitask', settings.language) },
    { id: 'advanced', icon: SlidersHorizontal, label: t('quick_mode_advanced', settings.language) },
  ];

  const track = status.current_track;
  const isFav = track ? favoriteTrackIds.has(track.id) : false;
  const trackFormat = track?.format?.toLowerCase() || '';
  const isDsd = trackFormat === 'dsf' || trackFormat === 'dff' || Boolean(engineStatus?.dsd_transport);
  const dsdQualityLabel = isDsd && engineStatus
    ? engineSourceDisplay(engineStatus)
    : null;
  const bitDepth = track?.bit_depth ?? track?.bits_per_sample ?? engineStatus?.output_bit_depth;
  const sampleRate = track?.sample_rate ?? engineStatus?.output_sample_rate;
  const sampleRateLabel = sampleRate && sampleRate > 0
    ? `${Number((sampleRate / 1000).toFixed(1))} kHz`
    : null;
  const qualityLabel = dsdQualityLabel || (
    track
      ? formatQualityLabel(track)
      : [
          bitDepth && bitDepth > 0 ? `${bitDepth}-bit` : null,
          sampleRateLabel,
        ].filter(Boolean).join(' / ')
  );

  const cycleLoopMode = () => {
    if (status.loop_mode === 'off') setLoopMode('playlist');
    else if (status.loop_mode === 'playlist') setLoopMode('track');
    else setLoopMode('off');
  };

  const repeatLabel = status.loop_mode === 'track'
    ? t('player_repeat_one', settings.language)
    : status.loop_mode === 'playlist'
      ? t('player_repeat_all', settings.language)
      : t('player_repeat_off', settings.language);

  const handlePlayerBarClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!track || !onNavigateNowPlaying) return;

    const target = event.target as HTMLElement;
    if (target.closest('button, [role="slider"]')) return;
    onNavigateNowPlaying();
  };

  const openCurrentArtist = () => {
    if (!track || !onNavigateArtist) return;
    const artist = artists.find(item => item.name.toLocaleLowerCase() === track.artist.toLocaleLowerCase()) ?? {
      id: `artist:${track.artist}`,
      name: track.artist,
      track_count: 0,
      album_count: 0,
      albums: [],
      genres: [],
    };
    onNavigateArtist(artist);
  };

  return (
    <footer
      role="region"
      aria-label={t('aria_audio_controls', settings.language)}
      onClick={handlePlayerBarClick}
      className={`app-player player-bar h-24 rounded-[26px] border border-brand-border/70 px-4 md:px-6 grid items-center z-40 relative select-none ${
        track && onNavigateNowPlaying ? 'cursor-pointer' : ''
      }`}
    >
      {/* Left: Track Details */}
      <div className="player-track flex min-w-0 items-center gap-3.5">
        {/* Cover Art */}
        <button
          type="button"
          onClick={() => track && onNavigateNowPlaying?.()}
          disabled={!track}
          className="player-artwork relative w-14 h-14 rounded-lg bg-brand-accent/12 border border-brand-accent/30 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer group shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-default"
          title={track ? 'Expand Now Playing' : 'No track loaded'}
          aria-label={track ? `Open now playing: ${track.title}` : 'No track loaded'}
        >
          <TrackArtwork
            track={track}
            className="absolute inset-0"
            iconClassName="w-6 h-6 text-brand-muted group-hover:scale-110 transition-transform"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <Disc3 className="w-4 h-4 text-white" />
          </div>
        </button>

        {/* Title & Artist & Badge */}
        <div className="flex min-w-0 max-w-full flex-col pr-2">
          {track ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsQueueDrawerOpen(true)}
                  className="block min-w-0 max-w-full truncate font-medium text-sm text-brand-foreground cursor-pointer text-left hover:underline hover:text-brand-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  aria-label={`Open current playlist for ${track.title}`}
                  title={track.title}
                >
                  {track.title}
                </button>
              </div>
              <button
                type="button"
                onClick={openCurrentArtist}
                disabled={!onNavigateArtist}
                className="block min-w-0 max-w-full truncate text-left text-xs text-brand-muted transition-colors hover:text-brand-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-default disabled:hover:text-brand-muted disabled:hover:no-underline"
                title={track.artist}
                aria-label={`Open artist ${track.artist}`}
              >
                {track.artist}
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {qualityLabel && (
                  <span
                    className="inline-flex items-center whitespace-nowrap rounded-md border border-cyan-400 bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold text-cyan-950 shadow-sm"
                    title={qualityLabel}
                    aria-label={`Audio quality: ${qualityLabel}`}
                  >
                    {qualityLabel}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-xs text-brand-muted italic">
              {t('empty_tracks_title', settings.language)}
            </span>
          )}
        </div>

        {/* Favorite Heart Button */}
        {track && (
          <button
            onClick={() => toggleFavoriteTrack(track.id)}
            className="player-favorite min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-rose-400 transition-colors focus-visible:outline-none"
            aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFav}
          >
            <Heart
              aria-hidden="true"
              className={`w-5 h-5 transition-transform active:scale-125 ${
                isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted hover:text-rose-400'
              }`}
            />
          </button>
        )}
      </div>

      {/* Center: Controls & Seekbar */}
      <div className="player-transport mx-auto flex w-full max-w-xl translate-y-1 flex-col items-center justify-center px-3">
        {/* Buttons */}
        <div className="flex h-11 items-center justify-center gap-3">
          {/* Shuffle */}
          <button
            onClick={toggleShuffle}
            className={`player-secondary-transport relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-[color,background-color,box-shadow,transform] duration-200 active:scale-95 focus-visible:outline-none ${
              status.shuffle
                ? 'bg-brand-accent/[0.07] text-brand-accent'
                : 'text-brand-muted hover:bg-oled-hover/70 hover:text-brand-foreground'
            }`}
            aria-label={status.shuffle ? t('player_shuffle_off', settings.language) : t('player_shuffle_on', settings.language)}
            aria-pressed={status.shuffle}
            title={status.shuffle ? t('player_shuffle_off', settings.language) : t('player_shuffle_on', settings.language)}
          >
            <Shuffle
              key={status.shuffle ? 'shuffle-on' : 'shuffle-off'}
              className="player-shuffle-toggle h-4 w-4 motion-reduce:animate-none"
              aria-hidden="true"
            />
            {status.shuffle && (
              <span className="absolute bottom-1.5 h-0.5 w-0.5 rounded-full bg-brand-accent" aria-hidden="true" />
            )}
          </button>

          {/* Previous */}
          <button
            onClick={prev}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-brand-foreground hover:bg-oled-hover hover:text-brand-accent transition-colors active:scale-95 focus-visible:outline-none"
            aria-label={t('player_prev', settings.language)}
          >
            <SkipBack className="w-5 h-5 fill-current" aria-hidden="true" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={togglePlayPause}
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-105 active:scale-95 transition-all focus-visible:outline-none"
            aria-label={status.state === 'playing' ? t('player_pause', settings.language) : t('player_play', settings.language)}
          >
            {status.state === 'playing' ? (
              <Pause className="w-5 h-5 fill-oled-base" aria-hidden="true" />
            ) : (
              <Play className="w-5 h-5 fill-oled-base ml-0.5" aria-hidden="true" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={next}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-brand-foreground hover:bg-oled-hover hover:text-brand-accent transition-colors active:scale-95 focus-visible:outline-none"
            aria-label={t('player_next', settings.language)}
          >
            <SkipForward className="w-5 h-5 fill-current" aria-hidden="true" />
          </button>

          {/* Repeat */}
          <button
            onClick={cycleLoopMode}
            className={`player-secondary-transport relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-[color,background-color,box-shadow,transform] duration-200 active:scale-95 focus-visible:outline-none ${
              status.loop_mode !== 'off'
                ? 'bg-brand-accent/[0.07] text-brand-accent'
                : 'text-brand-muted hover:bg-oled-hover/70 hover:text-brand-foreground'
            }`}
            aria-label={repeatLabel}
            aria-pressed={status.loop_mode !== 'off'}
            title={repeatLabel}
          >
            {status.loop_mode === 'track' ? (
              <Repeat1
                key="repeat-track"
                className="player-repeat-toggle h-4 w-4 motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Repeat
                key={`repeat-${status.loop_mode}`}
                className="player-repeat-toggle h-4 w-4 motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {status.loop_mode !== 'off' && (
              <span className="absolute bottom-1.5 h-0.5 w-0.5 rounded-full bg-brand-accent" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Time & Slider */}
          <PlayerSeekBar seek={seek} trackId={status.current_track?.id ?? null} />
      </div>

      {/* Right: Auxiliary & Volume Controls */}
      <div className="player-actions relative flex min-w-0 items-center justify-end gap-2">
        {/* Now Playing Button */}
        {onNavigateNowPlaying && (
          <button
            onClick={onNavigateNowPlaying}
            className={`player-action-now-playing min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none ${
              isNowPlayingOpen
                ? 'bg-oled-hover text-brand-accent'
                : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
            }`}
            aria-label={isNowPlayingOpen ? t('player_close_now_playing', settings.language) : t('player_now_playing', settings.language)}
            title={isNowPlayingOpen ? t('player_close_now_playing', settings.language) : t('player_now_playing', settings.language)}
            aria-expanded={isNowPlayingOpen}
          >
            <Disc3 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        {/* Equalizer Button */}
        <button
          type="button"
          onClick={() => {
            if (!eqAvailable) return;
            setIsEqualizerOpen(!isEqualizerOpen);
          }}
          disabled={!eqAvailable}
          className={`player-action-equalizer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none ${
            eqAvailable && (isEqualizerOpen || settings.eq_enabled)
              ? 'text-brand-accent bg-oled-hover'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
          aria-label={eqAvailable ? t('player_equalizer', settings.language) : t('player_equalizer_unavailable', settings.language)}
          title={eqAvailable ? t('player_equalizer', settings.language) : t('player_equalizer_unavailable', settings.language)}
          aria-expanded={isEqualizerOpen}
          aria-disabled={!eqAvailable}
        >
          <Sliders className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Queue Drawer Button */}
        <button
          onClick={() => setIsQueueDrawerOpen(!isQueueDrawerOpen)}
          className={`player-action-queue min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors relative focus-visible:outline-none ${
            isQueueDrawerOpen
              ? 'text-brand-accent bg-oled-hover'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
          aria-label={t('player_queue', settings.language)}
          title={t('player_queue', settings.language)}
          aria-expanded={isQueueDrawerOpen}
        >
          <ListMusic className="w-4 h-4" aria-hidden="true" />
          {queue.length > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-accent" />
          )}
        </button>

        {/* Volume Mute Toggle */}
        <button
          onClick={toggleMute}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none"
          aria-label={status.is_muted ? t('player_unmute', settings.language) : t('player_mute', settings.language)}
          aria-pressed={status.is_muted}
          title={engineStatus?.bit_perfect ? 'Đồng bộ với âm lượng thiết bị Windows' : undefined}
        >
          {displayedVolume === 0 ? (
            <VolumeX className="w-4 h-4 text-rose-400" aria-hidden="true" />
          ) : (
            <Volume2 className="w-4 h-4" aria-hidden="true" />
          )}
        </button>

        {/* Volume Slider */}
        <div
          className="player-volume-slider w-20 hidden sm:block"
          onWheel={handleVolumeWheel}
          title={`${Math.round(displayedVolume * 100)}%`}
        >
          <Slider
            value={displayedVolume}
            min={0}
            max={1}
            step={0.01}
            onChange={queueVolumeChange}
            onChangeEnd={commitVolumeChange}
            ariaLabel="Volume control"
          />
        </div>

        {/* Quick Audio Device Settings */}
        <button
          ref={deviceButtonRef}
          type="button"
          onClick={() => setIsDevicePopupOpen(open => !open)}
          className={`player-action-device min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors active:bg-oled-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
            isDevicePopupOpen
              ? 'bg-oled-hover text-brand-accent'
              : 'text-brand-muted hover:bg-oled-hover hover:text-brand-foreground'
          }`}
          aria-label={t('player_device_settings', settings.language)}
          title={t('player_device_settings', settings.language)}
          aria-haspopup="dialog"
          aria-expanded={isDevicePopupOpen}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>

        {isDevicePopupOpen && (
          <div
            ref={devicePopupRef}
            role="dialog"
            aria-label={t('player_device_settings_title', settings.language)}
            tabIndex={-1}
            onClick={event => event.stopPropagation()}
            className="absolute bottom-full right-0 z-[70] mb-3 w-[min(30rem,calc(100vw-2rem))] overflow-x-hidden rounded-2xl border border-brand-border bg-oled-card/95 shadow-2xl backdrop-blur-xl focus:outline-none"
          >
            <div className="flex items-center justify-between border-b border-brand-border/70 px-4 py-3">
              <div className="min-w-0">
                <h2 className="block min-w-0 max-w-full truncate text-sm font-semibold text-brand-foreground" title={t('player_device_settings_title', settings.language)}>
                  {t('player_device_settings_title', settings.language)}
                </h2>
                {engineStatus?.output_mode && (
                  <p className="mt-0.5 block min-w-0 max-w-full truncate text-[11px] text-brand-muted" title={engineStatus.output_mode}>{engineStatus.output_mode}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void loadOutputDevices()}
                disabled={isLoadingDevices || isSwitchingDevice}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-oled-hover hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-wait disabled:opacity-50"
                aria-label={t('player_device_settings_refresh', settings.language)}
                title={t('player_device_settings_refresh', settings.language)}
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              </button>
            </div>

            <div className="border-b border-brand-border/70 p-3">
              {isLoadingDevices && outputDevices.length === 0 ? (
                <div className="flex min-h-[44px] items-center justify-center gap-2 text-sm text-brand-muted" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t('settings_output_device_applying', settings.language)}
                </div>
              ) : outputDevices.length === 0 ? (
                <p className="flex min-h-[44px] items-center justify-center text-center text-sm text-brand-muted">
                  {t('player_device_settings_empty', settings.language)}
                </p>
              ) : (
                <label className="block space-y-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <span className="block">{t('settings_output_device', settings.language)}</span>
                  <select
                    value={settings.output_device || 'default'}
                    disabled={isSwitchingDevice}
                    onChange={event => void switchOutputDevice(event.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-brand-border bg-oled-base px-3 text-sm font-medium normal-case tracking-normal text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-wait disabled:opacity-60"
                  >
                    {outputDevices.map(device => (
                      <option key={device.id} value={device.id}>{device.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <fieldset className="border-t border-brand-border/70 p-3" aria-busy={isSwitchingDevice}>
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                {t('quick_playback_mode', settings.language)}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {playbackModeOptions.map(option => {
                  const selected = settings.playback_mode === option.id;
                  const Icon = option.icon;
                  return (
                    <label
                      key={option.id}
                      className={`flex min-h-[52px] cursor-pointer items-center gap-2 rounded-xl border p-2.5 transition-colors focus-within:ring-2 focus-within:ring-brand-accent ${
                        selected
                          ? 'border-brand-accent bg-brand-accent/10'
                          : 'border-brand-border bg-oled-base/70 hover:bg-oled-hover'
                      } ${isSwitchingDevice ? 'cursor-wait opacity-60' : ''}`}
                    >
                      <input
                        type="radio"
                        name="quick-playback-mode"
                        value={option.id}
                        checked={selected}
                        disabled={isSwitchingDevice}
                        onChange={() => changePlaybackMode(option.id)}
                        className="h-4 w-4 shrink-0 border-brand-border bg-oled-base text-brand-accent focus-visible:outline-none"
                      />
                      <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-brand-accent' : 'text-brand-muted'}`} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className={`block truncate text-xs font-semibold ${selected ? 'text-brand-accent' : 'text-brand-foreground'}`} title={option.label}>
                          {option.label}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {settings.playback_mode === 'advanced' && (
              <div className="grid grid-cols-1 gap-3 border-t border-brand-border/70 bg-oled-base/25 p-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <span className="block">{t('quick_audio_backend', settings.language)}</span>
                  <select
                    value={settings.audio_backend}
                    disabled={isSwitchingDevice}
                    onChange={event => changeAdvancedOption({ audio_backend: event.target.value as AudioBackend })}
                    className="min-h-[44px] w-full rounded-xl border border-brand-border bg-oled-base px-3 text-xs font-medium normal-case tracking-normal text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60"
                  >
                    <option value="shared">WASAPI Shared</option>
                    <option value="wasapi_exclusive" disabled={advancedGating.exclusiveBackendDisabled}>WASAPI Exclusive</option>
                    <option value="asio" disabled={advancedGating.asioBackendDisabled}>ASIO</option>
                  </select>
                </label>

                <label className="block space-y-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <span className="block">{t('quick_dsd_transport', settings.language)}</span>
                  <select
                    value={settings.dsd_output_mode}
                    disabled={isSwitchingDevice}
                    onChange={event => changeAdvancedOption({ dsd_output_mode: event.target.value as DsdOutputMode })}
                    className="min-h-[44px] w-full rounded-xl border border-brand-border bg-oled-base px-3 text-xs font-medium normal-case tracking-normal text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60"
                  >
                    <option value="native_dsd" disabled={advancedGating.nativeDsdDisabled}>Native DSD (ASIO)</option>
                    <option value="dop" disabled={advancedGating.dopDisabled}>DoP (DSD over PCM)</option>
                    <option value="pcm">DSD → PCM</option>
                  </select>
                </label>

                <label className="block space-y-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-muted sm:col-span-2">
                  <span className="block">{t('quick_asio_driver', settings.language)}</span>
                  <select
                    value={settings.asio_driver_id || ''}
                    disabled={advancedGating.asioBackendDisabled || asioDrivers.length === 0 || isSwitchingDevice}
                    onChange={event => changeAdvancedOption({ asio_driver_id: event.target.value || null })}
                    className="min-h-[44px] w-full rounded-xl border border-brand-border bg-oled-base px-3 text-xs font-medium normal-case tracking-normal text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60"
                  >
                    <option value="">Auto</option>
                    {asioDrivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                  </select>
                </label>

              </div>
            )}

            <div className="border-t border-brand-border/70 p-3" aria-live="polite">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                <Activity className="h-4 w-4 text-brand-accent" aria-hidden="true" />
                {t('quick_current_status', settings.language)}
              </div>
              <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
                <dt className="text-brand-muted">Backend</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-brand-foreground">{engineStatus?.output_mode || '—'}</dd>
                <dt className="text-brand-muted">{t('quick_source', settings.language)}</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-brand-foreground">{engineSourceDisplay(engineStatus)}</dd>
                <dt className="text-brand-muted">{t('quick_output', settings.language)}</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-brand-foreground">{engineTransportDisplay(engineStatus)}</dd>
                <dt className="text-brand-muted">{t('quick_volume', settings.language)}</dt>
                <dd className="min-w-0 truncate text-right font-semibold text-brand-foreground">
                  {engineStatus
                    ? `${Math.round(status.volume * 100)}% (${volumeControlLabel(engineStatus.volume_control_kind)})`
                    : '—'}
                </dd>
              </dl>
            </div>
          </div>
        )}

      </div>
    </footer>
  );
};

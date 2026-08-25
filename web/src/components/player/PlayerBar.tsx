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
} from 'lucide-react';
import { usePlayer, usePlaybackProgress } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { Slider } from '../common/Slider';
import { TrackArtwork } from '../common/TrackArtwork';
import { t } from '../../i18n';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * The only part of the player bar that subscribes to the ~10Hz playback
 * progress ticker, so the rest of the bar does not re-render on every tick.
 */
const PlayerSeekBar: React.FC<{ seek: (positionSecs: number) => Promise<void> }> = React.memo(
  ({ seek }) => {
    const { position, duration } = usePlaybackProgress();

    return (
      <div className="w-full flex items-center gap-3 text-xs text-brand-muted">
        <span className="w-10 text-right font-mono text-[11px] tabular-nums">
          {formatTime(position)}
        </span>
        <div className="flex-1">
          <Slider
            value={position}
            max={duration || 180}
            step={1}
            onChange={seek}
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

export const PlayerBar: React.FC<{ onNavigateNowPlaying?: () => void }> = ({ onNavigateNowPlaying }) => {
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

  const { toggleFavoriteTrack, favoriteTrackIds } = useLibrary();
  const { settings } = useSettings();

  const track = status.current_track;
  const isFav = track ? favoriteTrackIds.has(track.id) : false;
  const bitDepth = track?.bit_depth ?? track?.bits_per_sample ?? engineStatus?.output_bit_depth;
  const sampleRate = track?.sample_rate ?? engineStatus?.output_sample_rate;
  const sampleRateLabel = sampleRate && sampleRate > 0
    ? `${Number((sampleRate / 1000).toFixed(1))} kHz`
    : null;
  const qualityLabel = [
    bitDepth && bitDepth > 0 ? `${bitDepth}-bit` : null,
    sampleRateLabel,
  ].filter(Boolean).join(' / ');

  const cycleLoopMode = () => {
    if (status.loop_mode === 'off') setLoopMode('playlist');
    else if (status.loop_mode === 'playlist') setLoopMode('track');
    else setLoopMode('off');
  };

  return (
    <footer
      role="region"
      aria-label="Audio player controls"
      className="app-player player-bar h-24 rounded-[26px] border border-brand-border/70 px-4 md:px-6 grid items-center z-40 relative select-none"
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
        <div className="flex flex-col min-w-0 pr-2">
          {track ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateNowPlaying?.()}
                  className="font-medium text-sm text-brand-foreground truncate cursor-pointer text-left hover:underline hover:text-brand-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  title={track.title}
                >
                  {track.title}
                </button>
              </div>
              <span className="text-xs text-brand-muted truncate" title={track.artist}>
                {track.artist}
              </span>
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
            className={`player-secondary-transport min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors focus-visible:outline-none ${
              status.shuffle
                ? 'text-brand-accent'
                : 'text-brand-muted hover:text-brand-foreground'
            }`}
            aria-label={status.shuffle ? t('player_shuffle_off', settings.language) : t('player_shuffle_on', settings.language)}
            aria-pressed={status.shuffle}
          >
            <Shuffle className="w-4 h-4" aria-hidden="true" />
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
            className={`player-secondary-transport min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors focus-visible:outline-none ${
              status.loop_mode !== 'off'
                ? 'text-brand-accent'
                : 'text-brand-muted hover:text-brand-foreground'
            }`}
            aria-label={`Repeat mode: ${status.loop_mode}`}
            aria-pressed={status.loop_mode !== 'off'}
          >
            {status.loop_mode === 'track' ? (
              <Repeat1 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Repeat className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Time & Slider */}
        <PlayerSeekBar seek={seek} />
      </div>

      {/* Right: Auxiliary & Volume Controls */}
      <div className="player-actions flex min-w-0 items-center justify-end gap-2">
        {/* Now Playing Button */}
        {onNavigateNowPlaying && (
          <button
            onClick={onNavigateNowPlaying}
            className="player-action-now-playing min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none"
            aria-label={t('player_now_playing', settings.language)}
            title={t('player_now_playing', settings.language)}
          >
            <Disc3 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        {/* Equalizer Button */}
        <button
          onClick={() => setIsEqualizerOpen(!isEqualizerOpen)}
          className={`player-action-equalizer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors focus-visible:outline-none ${
            isEqualizerOpen || settings.eq_enabled
              ? 'text-brand-accent bg-oled-hover'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
          aria-label={t('player_equalizer', settings.language)}
          title={t('player_equalizer', settings.language)}
          aria-expanded={isEqualizerOpen}
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
          {status.is_muted || status.volume === 0 ? (
            <VolumeX className="w-4 h-4 text-rose-400" aria-hidden="true" />
          ) : (
            <Volume2 className="w-4 h-4" aria-hidden="true" />
          )}
        </button>

        {/* Volume Slider */}
        <div className="player-volume-slider w-20 hidden sm:block">
          <Slider
            value={status.is_muted ? 0 : status.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={setVolume}
            ariaLabel="Volume control"
          />
        </div>

      </div>
    </footer>
  );
};

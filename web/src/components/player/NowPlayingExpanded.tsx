import React, { useEffect, useMemo, useRef } from 'react';
import {
  Minimize2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  Music2,
  FileText,
} from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { Slider } from '../common/Slider';
import { Badge } from '../common/Badge';
import { parseLrc, findActiveLyricIndex } from '../../services/lrc';
import { t } from '../../i18n';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const NowPlayingExpanded: React.FC = () => {
  const {
    status,
    togglePlayPause,
    prev,
    next,
    seek,
    setVolume,
    toggleMute,
    setLoopMode,
    toggleShuffle,
    isNowPlayingExpanded,
    setIsNowPlayingExpanded,
  } = usePlayer();

  const { toggleFavoriteTrack, favoriteTrackIds } = useLibrary();
  const { settings } = useSettings();
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const track = status.current_track;
  const isFav = track ? favoriteTrackIds.has(track.id) : false;

  const parsedLyrics = useMemo(() => {
    if (!track?.lyrics) return null;
    return parseLrc(track.lyrics);
  }, [track?.lyrics]);

  const activeLyricIndex = useMemo(() => {
    if (!parsedLyrics || !parsedLyrics.is_synced) return -1;
    return findActiveLyricIndex(parsedLyrics.lines, status.position);
  }, [parsedLyrics, status.position]);

  // Auto-scroll lyrics into view
  useEffect(() => {
    if (activeLyricIndex >= 0 && lyricsContainerRef.current) {
      const activeEl = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [activeLyricIndex]);

  if (!isNowPlayingExpanded || !track) return null;

  const cycleLoopMode = () => {
    if (status.loop_mode === 'off') setLoopMode('playlist');
    else if (status.loop_mode === 'playlist') setLoopMode('track');
    else setLoopMode('off');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing View"
      className="fixed inset-0 z-50 bg-oled-base/98 text-brand-foreground flex flex-col backdrop-blur-2xl animate-fadeIn select-none"
    >
      {/* Top Bar */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-brand-border/40">
        <div className="flex items-center gap-3">
          <Badge track={track} />
          <span className="text-xs text-brand-muted">
            {t('nav_now_playing', settings.language)} • {track.genre || 'Local Audio'}
          </span>
        </div>

        <button
          onClick={() => setIsNowPlayingExpanded(false)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-oled-card border border-brand-border text-brand-muted hover:text-white hover:bg-oled-hover transition-colors focus-visible:outline-none"
          aria-label="Minimize now playing"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      </header>

      {/* Main split: Left Artwork / Right Synced Lyrics */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 p-8 max-w-7xl mx-auto w-full items-center overflow-hidden">
        {/* Left Artwork & Basic Info */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center text-center">
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-2xl bg-gradient-to-tr from-indigo-950 to-slate-900 border-2 border-brand-border shadow-2xl flex items-center justify-center overflow-hidden mb-6 group">
            <Music2
              className={`w-32 h-32 text-indigo-400/40 transition-transform duration-700 ${
                status.state === 'playing' ? 'scale-105 animate-pulse-slow' : ''
              }`}
            />
            {/* Vinyl record overlay animation */}
            <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none" />
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold font-display text-white tracking-tight truncate max-w-md">
            {track.title}
          </h2>
          <p className="text-base sm:text-lg text-brand-muted font-medium mt-1 truncate max-w-md">
            {track.artist}
          </p>
          <p className="text-xs text-indigo-300/70 mt-1">
            {track.album} {track.year ? `(${track.year})` : ''}
          </p>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => toggleFavoriteTrack(track.id)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-oled-card border border-brand-border text-brand-muted hover:text-rose-400 transition-colors focus-visible:outline-none"
              aria-label={isFav ? 'Remove favorite' : 'Add favorite'}
            >
              <Heart
                className={`w-5 h-5 ${
                  isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Right Synced Karaoke Lyrics */}
        <div className="lg:col-span-7 flex flex-col h-full max-h-[550px] bg-oled-card/60 border border-brand-border rounded-2xl p-6 backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-brand-border/40 mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-foreground font-display">
              <FileText className="w-4 h-4 text-brand-accent" />
              <span>{t('lyrics_title', settings.language)}</span>
            </div>
            {parsedLyrics?.is_synced && (
              <span className="text-[11px] font-medium text-brand-accent bg-brand-accent/10 px-2.5 py-0.5 rounded-full border border-brand-accent/30">
                {t('lyrics_synced_mode', settings.language)}
              </span>
            )}
          </div>

          <div
            ref={lyricsContainerRef}
            className="flex-1 overflow-y-auto pr-2 space-y-4 text-center scroll-smooth"
          >
            {parsedLyrics && parsedLyrics.lines.length > 0 ? (
              parsedLyrics.lines.map((line, idx) => {
                const isActive = idx === activeLyricIndex;
                return (
                  <div
                    key={idx}
                    onClick={() => seek(line.timestamp)}
                    className={`py-2 px-4 rounded-xl cursor-pointer transition-all duration-300 ${
                      isActive
                        ? 'text-brand-accent font-bold text-xl sm:text-2xl scale-105 bg-brand-accent/10 border border-brand-accent/30 shadow-glow-accent'
                        : 'text-brand-muted/70 hover:text-brand-foreground text-sm sm:text-base hover:bg-oled-hover'
                    }`}
                  >
                    {line.text}
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-brand-muted gap-2">
                <FileText className="w-10 h-10 stroke-1" />
                <p className="text-sm">{t('lyrics_not_available', settings.language)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Controls Bar in Fullscreen Mode */}
      <footer className="p-6 bg-oled-card/90 border-t border-brand-border max-w-5xl mx-auto w-full rounded-t-2xl flex flex-col gap-3">
        {/* Seekbar */}
        <div className="w-full flex items-center gap-4 text-xs text-brand-muted">
          <span className="w-12 text-right font-mono tabular-nums">
            {formatTime(status.position)}
          </span>
          <div className="flex-1">
            <Slider
              value={status.position}
              max={status.duration || 180}
              step={1}
              onChange={seek}
              ariaLabel="Expanded seek"
            />
          </div>
          <span className="w-12 text-left font-mono tabular-nums">
            {formatTime(status.duration)}
          </span>
        </div>

        {/* Buttons & Volume */}
        <div className="flex items-center justify-between">
          <div className="w-24" />

          {/* Center Playback Controls */}
          <div className="flex items-center gap-6">
            <button
              onClick={toggleShuffle}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors focus-visible:outline-none ${
                status.shuffle ? 'text-brand-accent' : 'text-brand-muted hover:text-white'
              }`}
              aria-label="Toggle shuffle"
            >
              <Shuffle className="w-5 h-5" />
            </button>

            <button
              onClick={prev}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-white hover:text-brand-accent transition-colors focus-visible:outline-none"
              aria-label="Previous track"
            >
              <SkipBack className="w-6 h-6 fill-current" />
            </button>

            <button
              onClick={togglePlayPause}
              className="w-14 h-14 rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-105 active:scale-95 transition-all focus-visible:outline-none"
              aria-label="Play or Pause"
            >
              {status.state === 'playing' ? (
                <Pause className="w-7 h-7 fill-oled-base" />
              ) : (
                <Play className="w-7 h-7 fill-oled-base ml-1" />
              )}
            </button>

            <button
              onClick={next}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-white hover:text-brand-accent transition-colors focus-visible:outline-none"
              aria-label="Next track"
            >
              <SkipForward className="w-6 h-6 fill-current" />
            </button>

            <button
              onClick={cycleLoopMode}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors focus-visible:outline-none ${
                status.loop_mode !== 'off' ? 'text-brand-accent' : 'text-brand-muted hover:text-white'
              }`}
              aria-label="Toggle repeat"
            >
              {status.loop_mode === 'track' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3 w-36">
            <button
              onClick={toggleMute}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-white focus-visible:outline-none"
              aria-label="Mute toggle"
            >
              {status.is_muted || status.volume === 0 ? (
                <VolumeX className="w-5 h-5 text-rose-400" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>
            <div className="flex-1">
              <Slider
                value={status.is_muted ? 0 : status.volume}
                min={0}
                max={1}
                step={0.01}
                onChange={setVolume}
                ariaLabel="Volume slider"
              />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

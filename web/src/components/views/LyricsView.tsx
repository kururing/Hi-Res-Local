import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Heart, RefreshCw } from 'lucide-react';
import { usePlayer, usePlaybackProgress } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge } from '../common/Badge';
import { TrackArtwork } from '../common/TrackArtwork';
import {
  parseLrc,
  normalizeLyricsData,
  findActiveLyricIndex,
  computeEffectiveLyricsMode,
  hasCompleteRomanizedLyrics,
} from '../../services/lrc';
import { IpcService } from '../../services/ipc';
import { LyricData, LyricLine, LyricsMode } from '../../types/lyrics';
import { t } from '../../i18n';
import { hydrateRomanizedLyrics } from '../../services/romanizedLyrics';
import { Storage } from '../../services/storage';

const capitalizeFirstLetter = (text: string): string =>
  text.replace(/\p{L}/u, letter => letter.toLocaleUpperCase());

const capitalizeLyricsText = (text: string): string =>
  text.split(/\r?\n/).map(capitalizeFirstLetter).join('\n');

export const LyricsView: React.FC = () => {
  const { status, seek } = usePlayer();
  const { position } = usePlaybackProgress();
  const { favoriteTrackIds, toggleFavoriteTrack } = useLibrary();
  const { settings } = useSettings();
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const track = status.current_track;
  const isFavorite = track ? favoriteTrackIds.has(track.id) : false;
  const [lyricsData, setLyricsData] = useState<LyricData | null>(null);
  const [preferredMode, setPreferredMode] = useState<LyricsMode>(() => Storage.getLyricsMode());
  const [loading, setLoading] = useState<boolean>(false);
  const [isFollowingLyrics, setIsFollowingLyrics] = useState(true);

  const selectLyricsMode = (mode: LyricsMode) => {
    setPreferredMode(mode);
    Storage.saveLyricsMode(mode);
  };

  // Fetch track lyrics via IPC with stale request cancellation
  useEffect(() => {
    if (!track?.id) {
      setLyricsData(null);
      return;
    }

    let isCurrent = true;
    setLoading(true);

    IpcService.invoke('get_track_lyrics', { trackId: track.id })
      .then(async res => {
        if (!isCurrent) return;
        let hydrated: LyricData | null = null;
        if (res) {
          const normalized = normalizeLyricsData(res);
          hydrated = normalized ? await hydrateRomanizedLyrics(track.id, normalized) : null;
        } else if (track.lyrics) {
          hydrated = await hydrateRomanizedLyrics(track.id, parseLrc(track.lyrics));
        }
        if (isCurrent) setLyricsData(hydrated);
      })
      .catch(async error => {
        if (!isCurrent) return;
        console.warn('Failed to load lyrics', error);
        if (track.lyrics) {
          const hydrated = await hydrateRomanizedLyrics(track.id, parseLrc(track.lyrics));
          if (isCurrent) setLyricsData(hydrated);
        } else {
          setLyricsData(null);
        }
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [track?.id, track?.lyrics]);

  // Coerce lyrics mode safely based on actual data
  const lyricsMode = useMemo(
    () => computeEffectiveLyricsMode(lyricsData, preferredMode),
    [lyricsData, preferredMode]
  );

  // Check if romanized lyrics and original lyrics are both present
  const hasRomanized = useMemo(() => {
    return lyricsData ? hasCompleteRomanizedLyrics(lyricsData) : false;
  }, [lyricsData]);

  const hasOriginal = useMemo(() => {
    if (!lyricsData) return false;
    return Boolean(
      (lyricsData.plain_text && lyricsData.plain_text.trim().length > 0) ||
        (lyricsData.lines && lyricsData.lines.length > 0)
    );
  }, [lyricsData]);

  // Determine active lines based on mode
  const displayLines: LyricLine[] = useMemo(() => {
    if (!lyricsData) return [];

    if (lyricsMode === 'romanized') {
      if (lyricsData.romanized && lyricsData.romanized.lines.length > 0) {
        return lyricsData.romanized.lines;
      }
      return lyricsData.lines.map(l => ({
        ...l,
        text: l.romanized || l.text,
      }));
    }

    if (lyricsMode === 'both') {
      if (lyricsData.lines.length > 0) {
        return lyricsData.lines;
      }
      if (lyricsData.romanized && lyricsData.romanized.lines.length > 0) {
        return lyricsData.romanized.lines;
      }
    }

    return lyricsData.lines;
  }, [lyricsData, lyricsMode]);

  const isSynced = useMemo(() => {
    if (!lyricsData) return false;
    if (lyricsMode === 'romanized' && lyricsData.romanized) {
      return lyricsData.romanized.is_synced;
    }
    return (lyricsData.is_synced || lyricsData.romanized?.is_synced) && displayLines.length > 0;
  }, [lyricsData, lyricsMode, displayLines]);

  const activeLyricIndex = useMemo(() => {
    if (!isSynced || displayLines.length === 0) return -1;
    return findActiveLyricIndex(displayLines, position);
  }, [isSynced, displayLines, position]);

  // Auto-scroll active line into view smoothly
  useEffect(() => {
    if (isFollowingLyrics && activeLyricIndex >= 0 && lyricsContainerRef.current) {
      const activeEl = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      if (activeEl) {
        lyricsContainerRef.current.scrollTo({
          top:
            activeEl.offsetTop -
            lyricsContainerRef.current.clientHeight * 0.3 +
            activeEl.offsetHeight / 2,
          behavior: 'smooth',
        });
      }
    }
  }, [activeLyricIndex, isFollowingLyrics]);

  useEffect(() => setIsFollowingLyrics(true), [track?.id]);

  return (
    <div className="min-h-0 min-w-0 h-full overflow-x-hidden px-5 md:px-7 pt-4 max-w-7xl mx-auto w-full flex gap-6 xl:gap-10 select-none">
      {track && (
        <aside className="hidden lg:flex w-52 xl:w-60 shrink-0 flex-col items-center justify-center pb-20 text-center">
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-brand-border/60 bg-oled-card/45 shadow-card-elevated">
            <TrackArtwork
              track={track}
              className="absolute inset-0"
              iconClassName="h-16 w-16 text-brand-muted/60"
            />
          </div>
          <h1 className="mt-5 max-w-full truncate text-xl font-bold text-brand-foreground" title={track.title}>
            {track.title}
          </h1>
          <span className="mt-1 max-w-full truncate px-2 py-1 text-sm font-semibold text-brand-foreground/85" title={track.artist}>
            {track.artist}
          </span>
          <p className="mt-0.5 max-w-full truncate text-xs font-medium text-brand-muted" title={track.album}>
            {track.album}{track.year ? ` (${track.year})` : ''}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Badge track={track} />
            <button
              type="button"
              onClick={() => toggleFavoriteTrack(track.id)}
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFavorite}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-brand-border/60 text-brand-muted transition-colors hover:bg-oled-hover hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              <Heart className={`h-4 w-4 ${isFavorite ? 'fill-rose-500 text-rose-500' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}
      <div className="min-w-0 flex-1 relative overflow-hidden flex flex-col">
        <div className="flex items-center justify-center pb-2 shrink-0 gap-3 flex-wrap">
            {/* Accessible Segmented Selector for Lyrics Mode with role=group and aria-pressed */}
            {hasRomanized && hasOriginal && (
              <div
                role="group"
                aria-label={t('lyrics_mode_aria', settings.language)}
                className="flex items-center p-1 bg-oled-hover border border-brand-border rounded-xl"
              >
                <button
                  type="button"
                  aria-pressed={lyricsMode === 'original'}
                  onClick={() => selectLyricsMode('original')}
                  className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none ${
                    lyricsMode === 'original'
                      ? 'bg-brand-accent text-oled-base shadow-sm'
                      : 'text-brand-foreground/75 hover:text-brand-foreground hover:bg-oled-card/60'
                  }`}
                >
                  {t('lyrics_mode_original', settings.language)}
                </button>
                <button
                  type="button"
                  aria-pressed={lyricsMode === 'romanized'}
                  onClick={() => selectLyricsMode('romanized')}
                  className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none ${
                    lyricsMode === 'romanized'
                      ? 'bg-brand-accent text-oled-base shadow-sm'
                      : 'text-brand-foreground/75 hover:text-brand-foreground hover:bg-oled-card/60'
                  }`}
                >
                  {t('lyrics_mode_romanized', settings.language)}
                </button>
                <button
                  type="button"
                  aria-pressed={lyricsMode === 'both'}
                  onClick={() => selectLyricsMode('both')}
                  className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none ${
                    lyricsMode === 'both'
                      ? 'bg-brand-accent text-oled-base shadow-sm'
                      : 'text-brand-foreground/75 hover:text-brand-foreground hover:bg-oled-card/60'
                  }`}
                >
                  {t('lyrics_mode_both', settings.language)}
                </button>
              </div>
            )}

        </div>

        {/* Lyrics Content Container */}
        <div
          ref={lyricsContainerRef}
          onWheel={() => setIsFollowingLyrics(false)}
          onTouchStart={() => setIsFollowingLyrics(false)}
          onPointerDown={() => setIsFollowingLyrics(false)}
          className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-2 space-y-4 py-8 text-center scroll-smooth"
        >
          {loading ? (
            <div className="h-full flex items-center justify-center text-brand-muted text-sm animate-pulse">
              {t('lyrics_title', settings.language)}...
            </div>
          ) : isSynced && displayLines.length > 0 ? (
            displayLines.map((line, idx) => {
              const isActive = idx === activeLyricIndex;
              const hasSub =
                lyricsMode === 'both' &&
                Boolean(
                  line.romanized &&
                    line.romanized.trim() &&
                    line.romanized.trim().toLocaleLowerCase() !==
                      line.text.trim().toLocaleLowerCase()
                );

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => seek(line.timestamp)}
                  className="group flex min-h-[52px] w-full cursor-pointer items-center justify-center px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <span
                    className={`inline-flex max-w-full flex-col items-center gap-1 rounded-[1.6rem] px-5 py-3 transition-[color,background-color,box-shadow,transform] duration-300 sm:px-8 ${
                      isActive
                        ? 'scale-[1.015] bg-gradient-to-r from-transparent via-brand-accent/15 to-transparent shadow-[0_10px_30px_rgba(0,0,0,0.12)]'
                        : 'group-hover:bg-oled-hover/35'
                    }`}
                  >
                    <span
                      className={`transition-colors duration-200 ${
                        isActive
                          ? 'text-brand-foreground font-bold text-2xl sm:text-3xl'
                          : 'text-brand-foreground/72 group-hover:text-brand-foreground text-base sm:text-lg'
                      }`}
                    >
                      {capitalizeFirstLetter(line.text)}
                    </span>
                    {hasSub && (
                      <span
                        className={`transition-colors duration-200 ${
                          isActive
                            ? 'text-brand-foreground/85 font-semibold text-base sm:text-lg'
                            : 'text-brand-foreground/60 text-xs sm:text-sm'
                        }`}
                      >
                        {capitalizeFirstLetter(line.romanized ?? '')}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ) : (lyricsData?.plain_text && lyricsData.plain_text.trim().length > 0) ||
            (lyricsData?.romanized?.plain_text && lyricsData.romanized.plain_text.trim().length > 0) ? (
            /* Plain Text Fallback */
            <div className="space-y-4 max-w-2xl mx-auto text-left py-6 px-4">
              {lyricsMode !== 'romanized' && lyricsData?.plain_text && (
                <div className="whitespace-pre-line text-brand-foreground text-sm sm:text-base leading-relaxed p-4">
                  {capitalizeLyricsText(lyricsData.plain_text)}
                </div>
              )}
              {lyricsMode !== 'original' && lyricsData?.romanized?.plain_text && (
                <div className="whitespace-pre-line text-brand-foreground text-sm sm:text-base leading-relaxed p-4">
                  {capitalizeLyricsText(lyricsData.romanized.plain_text)}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-brand-muted gap-2">
              <FileText className="w-12 h-12 stroke-1" />
              <p className="text-sm">{t('lyrics_not_available', settings.language)}</p>
            </div>
          )}
        </div>

        {!isFollowingLyrics && isSynced && (
          <button
            type="button"
            onClick={() => setIsFollowingLyrics(true)}
            className="absolute bottom-4 right-4 z-20 inline-flex h-10 items-center gap-1.5 rounded-full border border-brand-accent/45 bg-oled-card/90 px-3 text-[11px] font-semibold text-brand-foreground shadow-card-elevated backdrop-blur-md transition-colors hover:border-brand-accent hover:bg-brand-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            aria-label={t('lyrics_sync_button', settings.language)}
            title={t('lyrics_sync_button', settings.language)}
          >
            <RefreshCw className="h-3.5 w-3.5 text-brand-accent" aria-hidden="true" />
            {t('lyrics_sync_button', settings.language)}
          </button>
        )}
      </div>
    </div>
  );
};

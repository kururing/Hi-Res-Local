import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Heart, Minus, Music2, Plus, RefreshCw, RotateCcw } from 'lucide-react';
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
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);
  const [isLyricsOffsetOpen, setIsLyricsOffsetOpen] = useState(false);

  const selectLyricsMode = (mode: LyricsMode) => {
    setPreferredMode(mode);
    Storage.saveLyricsMode(mode);
  };

  useEffect(() => {
    setIsLyricsOffsetOpen(false);
    if (!track?.id) {
      setLyricsOffsetMs(0);
      return;
    }

    const key = `nghenhac_lyrics_offset:${track.id}`;
    try {
      const stored = Number(localStorage.getItem(key));
      setLyricsOffsetMs(Number.isFinite(stored) ? Math.max(-60000, Math.min(60000, stored)) : 0);
    } catch {
      setLyricsOffsetMs(0);
    }
  }, [track?.id]);

  const changeLyricsOffset = (deltaMs: number) => {
    if (!track?.id) return;
    const next = Math.max(-60000, Math.min(60000, lyricsOffsetMs + deltaMs));
    setLyricsOffsetMs(next);
    const key = `nghenhac_lyrics_offset:${track.id}`;
    try {
      if (next === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, String(next));
    } catch {
      // The adjustment remains active for this session even if storage is unavailable.
    }
  };

  // Fetch track lyrics via IPC with stale request cancellation
  useEffect(() => {
    if (!track?.id) {
      setLyricsData(null);
      return;
    }

    let isCurrent = true;
    setLoading(true);

    const fetchRemoteLyrics = async (): Promise<LyricData | null> => {
      // v2 invalidates results chosen by the old single-result LRCLIB lookup.
      const cacheKey = `nghenhac_lrclib_lyrics:v2:${track.id}:${track.title}:${track.artist}:${track.album}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = normalizeLyricsData(JSON.parse(cached));
          if (parsed) return parsed;
        }
      } catch {
        // Ignore malformed or unavailable local cache and query LRCLIB.
      }

      try {
        const remote = await IpcService.invoke('fetch_lrclib_lyrics', { trackId: track.id });
        if (!remote) return null;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(remote));
        } catch {
          // Caching is optional; lyrics can still be displayed this time.
        }
        return normalizeLyricsData(remote);
      } catch (error) {
        console.warn('Failed to load lyrics from LRCLIB', error);
        return null;
      }
    };

    IpcService.invoke('get_track_lyrics', { trackId: track.id })
      .then(async res => {
        if (!isCurrent) return;
        let hydrated: LyricData | null = null;
        if (res) {
          const normalized = normalizeLyricsData(res);
          hydrated = normalized ? await hydrateRomanizedLyrics(track.id, normalized) : null;
        } else if (track.lyrics) {
          hydrated = await hydrateRomanizedLyrics(track.id, parseLrc(track.lyrics));
        } else {
          const normalizedRemote = await fetchRemoteLyrics();
          hydrated = normalizedRemote ? await hydrateRomanizedLyrics(track.id, normalizedRemote) : null;
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
          const normalizedRemote = await fetchRemoteLyrics();
          if (isCurrent) setLyricsData(normalizedRemote ? await hydrateRomanizedLyrics(track.id, normalizedRemote) : null);
        }
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [track?.id, track?.lyrics, track?.title, track?.artist, track?.album]);

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

  const timedDisplayLines: LyricLine[] = useMemo(
    () => {
      const appliedOffsetMs = lyricsData?.source === 'lrclib' ? lyricsOffsetMs : 0;
      return displayLines.map(line => ({
        ...line,
        timestamp: Math.max(0, line.timestamp + appliedOffsetMs / 1000),
      }));
    },
    [displayLines, lyricsData?.source, lyricsOffsetMs]
  );

  const isSynced = useMemo(() => {
    if (!lyricsData) return false;
    if (lyricsMode === 'romanized' && lyricsData.romanized) {
      return lyricsData.romanized.is_synced;
    }
    return (lyricsData.is_synced || lyricsData.romanized?.is_synced) && displayLines.length > 0;
  }, [lyricsData, lyricsMode, displayLines]);

  const activeLyricIndex = useMemo(() => {
    if (!isSynced || displayLines.length === 0) return -1;
    return findActiveLyricIndex(timedDisplayLines, position);
  }, [isSynced, timedDisplayLines, position]);

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

  useEffect(() => {
    setIsFollowingLyrics(true);
  }, [track?.id]);

  return (
    <div className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-7xl gap-6 overflow-x-hidden px-5 pt-4 select-none md:px-7 xl:gap-10">
      {track && (
        <aside className="hidden w-64 shrink-0 flex-col items-center justify-center text-center lg:flex xl:w-72">
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
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:pl-6 xl:pl-12 2xl:pl-16">
        <div className="flex items-center justify-center pb-2 shrink-0 gap-3 flex-wrap">
            {/* Accessible Segmented Selector for Lyrics Mode with role=group and aria-pressed */}
            {hasRomanized && hasOriginal && (
              <div
                role="group"
                aria-label={t('lyrics_mode_aria', settings.language)}
                className="flex items-center rounded-xl border border-brand-border/50 bg-oled-card/35 p-1 shadow-sm backdrop-blur-xl"
              >
                <button
                  type="button"
                  aria-pressed={lyricsMode === 'original'}
                  onClick={() => selectLyricsMode('original')}
                  className={`min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none ${
                    lyricsMode === 'original'
                      ? 'bg-brand-accent/30 text-brand-foreground shadow-sm ring-1 ring-inset ring-brand-accent/45'
                      : 'text-brand-foreground/70 hover:bg-oled-card/35 hover:text-brand-foreground'
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
                      ? 'bg-brand-accent/30 text-brand-foreground shadow-sm ring-1 ring-inset ring-brand-accent/45'
                      : 'text-brand-foreground/70 hover:bg-oled-card/35 hover:text-brand-foreground'
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
                      ? 'bg-brand-accent/30 text-brand-foreground shadow-sm ring-1 ring-inset ring-brand-accent/45'
                      : 'text-brand-foreground/70 hover:bg-oled-card/35 hover:text-brand-foreground'
                  }`}
                >
                  {t('lyrics_mode_both', settings.language)}
                </button>
              </div>
            )}
            {lyricsData?.source === 'lrclib' && (
              <button
                type="button"
                aria-expanded={isLyricsOffsetOpen}
                aria-controls="lyrics-offset-controls"
                onClick={() => setIsLyricsOffsetOpen(open => !open)}
                className={`min-h-[44px] rounded-full border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
                  isLyricsOffsetOpen
                    ? 'border-brand-accent/60 bg-brand-accent/15 text-brand-foreground'
                    : 'border-brand-border/60 bg-oled-card/35 text-brand-muted hover:bg-oled-hover hover:text-brand-foreground'
                }`}
              >
                {t('lyrics_source_lrclib', settings.language)}
              </button>
            )}
            {lyricsData?.source === 'lrclib' && isLyricsOffsetOpen && isSynced && timedDisplayLines.length > 0 && (
              <div
                id="lyrics-offset-controls"
                role="group"
                aria-label={t('lyrics_offset_label', settings.language)}
                className="flex items-center gap-1 rounded-xl border border-brand-border/50 bg-oled-card/35 p-1 shadow-sm backdrop-blur-xl"
              >
                <span className="px-2 text-xs font-semibold text-brand-muted" aria-live="polite">
                  {t('lyrics_offset_current', settings.language, {
                    value: `${lyricsOffsetMs > 0 ? '+' : ''}${(lyricsOffsetMs / 1000).toFixed(1)}s`,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => changeLyricsOffset(-500)}
                  aria-label={t('lyrics_offset_earlier', settings.language)}
                  title={t('lyrics_offset_earlier', settings.language)}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-foreground/80 transition-colors hover:bg-oled-hover hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                  0.5s
                </button>
                <button
                  type="button"
                  onClick={() => changeLyricsOffset(500)}
                  aria-label={t('lyrics_offset_later', settings.language)}
                  title={t('lyrics_offset_later', settings.language)}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-foreground/80 transition-colors hover:bg-oled-hover hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  0.5s
                </button>
                <button
                  type="button"
                  onClick={() => changeLyricsOffset(-lyricsOffsetMs)}
                  disabled={lyricsOffsetMs === 0}
                  aria-label={t('lyrics_offset_reset', settings.language)}
                  title={t('lyrics_offset_reset', settings.language)}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-oled-hover hover:text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-default disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
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
          className={`relative min-h-0 min-w-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain py-8 pr-0.5 text-left ${
            isSynced && timedDisplayLines.length <= 8 ? 'flex min-h-full flex-col justify-center' : ''
          }`}
        >
          {loading ? (
            <div className="h-full flex items-center justify-center text-brand-muted text-sm animate-pulse">
              {t('lyrics_title', settings.language)}...
            </div>
          ) : isSynced && displayLines.length > 0 ? (
            timedDisplayLines.map((line, idx) => {
              const isActive = idx === activeLyricIndex;
              const hasSub =
                lyricsMode === 'both' &&
                Boolean(
                  line.romanized &&
                    line.romanized.trim() &&
                    line.romanized.trim().toLocaleLowerCase() !==
                    line.text.trim().toLocaleLowerCase()
                );
              const isBlank = !line.text.trim() && !line.romanized?.trim();

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    void seek(line.timestamp);
                    setIsFollowingLyrics(true);
                  }}
                  aria-label={isBlank ? `Seek to ${line.timestamp.toFixed(1)} seconds` : capitalizeFirstLetter(line.text)}
                  className="group mx-auto flex min-h-[52px] w-full max-w-5xl cursor-pointer items-center justify-start px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <span
                    className={`inline-flex max-w-full flex-col items-start gap-1 rounded-[1.6rem] text-left transition-[color,background-color,box-shadow] duration-200 ${
                      isActive
                        ? '-mx-2 -my-1 rounded-[1.8rem] bg-gradient-to-r from-transparent via-brand-accent/15 to-transparent px-7 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.12)] sm:px-10'
                        : 'px-5 py-3 group-hover:bg-oled-hover/35 sm:px-8'
                    }`}
                  >
                    {isBlank ? (
                      <Music2
                        aria-hidden="true"
                        className={`h-7 w-7 font-bold transition-colors duration-200 sm:h-8 sm:w-8 ${
                          isActive
                            ? 'text-brand-accent'
                            : 'text-brand-foreground/45 group-hover:text-brand-foreground/70'
                        }`}
                      />
                    ) : (
                      <span
                        className={`text-2xl font-bold transition-colors duration-200 sm:text-3xl ${
                          isActive
                            ? 'text-brand-foreground'
                            : 'text-brand-foreground/72 group-hover:text-brand-foreground'
                        }`}
                      >
                        {capitalizeFirstLetter(line.text)}
                      </span>
                    )}
                    {hasSub && (
                      <span
                        className={`text-base font-semibold transition-colors duration-200 sm:text-lg ${
                          isActive
                            ? 'text-brand-foreground/85'
                            : 'text-brand-foreground/60'
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
            <div className="mx-auto max-w-5xl space-y-4 px-2 py-6 text-left">
              {lyricsMode !== 'romanized' && lyricsData?.plain_text && (
                <div className="whitespace-pre-line p-4 text-lg font-bold leading-relaxed text-brand-foreground sm:text-xl">
                  {capitalizeLyricsText(lyricsData.plain_text)}
                </div>
              )}
              {lyricsMode !== 'original' && lyricsData?.romanized?.plain_text && (
                <div className="whitespace-pre-line p-4 text-lg font-bold leading-relaxed text-brand-foreground sm:text-xl">
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

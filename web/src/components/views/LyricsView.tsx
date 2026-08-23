import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, Music2 } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { parseLrc, findActiveLyricIndex } from '../../services/lrc';
import { Badge } from '../common/Badge';
import { t } from '../../i18n';

export const LyricsView: React.FC = () => {
  const { status, seek } = usePlayer();
  const { settings } = useSettings();
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const track = status.current_track;

  const parsedLyrics = useMemo(() => {
    if (!track?.lyrics) return null;
    return parseLrc(track.lyrics);
  }, [track?.lyrics]);

  const activeLyricIndex = useMemo(() => {
    if (!parsedLyrics || !parsedLyrics.is_synced) return -1;
    return findActiveLyricIndex(parsedLyrics.lines, status.position);
  }, [parsedLyrics, status.position]);

  // Auto-scroll active line
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

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto w-full h-[calc(100vh-10rem)] flex flex-col gap-6 select-none">
      {/* Track Header */}
      {track ? (
        <div className="flex items-center justify-between p-4 rounded-2xl bg-oled-card border border-brand-border shrink-0 shadow-sm">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-indigo-950/80 border border-brand-border flex items-center justify-center shrink-0">
              <Music2 className="w-6 h-6 text-brand-accent" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-base text-brand-foreground truncate">
                {track.title}
              </span>
              <span className="text-xs text-brand-muted truncate">
                {track.artist} • {track.album}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge track={track} />
          </div>
        </div>
      ) : (
        <div className="p-6 text-center text-brand-muted bg-oled-card rounded-2xl border border-brand-border">
          {t('empty_tracks_title', settings.language)}
        </div>
      )}

      {/* Lyrics Scroll Box */}
      <div className="flex-1 bg-oled-card/70 border border-brand-border rounded-2xl p-6 backdrop-blur-md relative overflow-hidden flex flex-col">
        <div className="flex items-center justify-between pb-3 border-b border-brand-border/40 mb-4 shrink-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-brand-foreground font-display">
            <FileText className="w-4 h-4 text-brand-accent" />
            <span>{t('lyrics_title', settings.language)}</span>
          </div>

          {parsedLyrics?.is_synced && (
            <span className="text-xs font-semibold text-brand-accent bg-brand-accent/15 px-3 py-1 rounded-full border border-brand-accent/30 shadow-sm">
              {t('lyrics_synced_mode', settings.language)}
            </span>
          )}
        </div>

        <div
          ref={lyricsContainerRef}
          className="flex-1 overflow-y-auto pr-2 space-y-6 text-center scroll-smooth py-12"
        >
          {parsedLyrics && parsedLyrics.lines.length > 0 ? (
            parsedLyrics.lines.map((line, idx) => {
              const isActive = idx === activeLyricIndex;
              return (
                <div
                  key={idx}
                  onClick={() => seek(line.timestamp)}
                  className={`py-2 px-6 rounded-2xl cursor-pointer transition-all duration-300 ${
                    isActive
                      ? 'text-brand-accent font-bold text-2xl sm:text-3xl scale-105 bg-brand-accent/10 border border-brand-accent/40 shadow-glow-accent'
                      : 'text-brand-muted/70 hover:text-brand-foreground text-base sm:text-lg hover:bg-oled-hover'
                  }`}
                >
                  {line.text}
                </div>
              );
            })
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-brand-muted gap-2">
              <FileText className="w-12 h-12 stroke-1" />
              <p className="text-sm">{t('lyrics_not_available', settings.language)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

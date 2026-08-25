import React, { useEffect, useRef } from 'react';
import { X, Trash2, ArrowUp, ArrowDown, Save, Music2 } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';
import { VirtualList } from '../common/VirtualList';

export const QueueDrawer: React.FC = () => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const {
    queue,
    queueIndex,
    status,
    playQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    isQueueDrawerOpen,
    setIsQueueDrawerOpen,
  } = usePlayer();

  const { createPlaylist, updatePlaylist } = usePlaylists();
  const { settings } = useSettings();

  const currentTrack = status.current_track;
  const currentTrackIndex = currentTrack
    ? queue.findIndex(track => track.id === currentTrack.id && track.path === currentTrack.path)
    : -1;
  const displayedQueueIndex = currentTrackIndex >= 0 ? currentTrackIndex : queueIndex;
  const queueStartIndex = displayedQueueIndex >= 0 ? displayedQueueIndex : 0;
  const visibleQueue = queue.slice(queueStartIndex).map((track, visibleIndex) => ({
    track,
    originalIndex: queueStartIndex + visibleIndex,
  }));

  useEffect(() => {
    if (!isQueueDrawerOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsQueueDrawerOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>('button')?.focus());
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previous?.focus();
    };
  }, [isQueueDrawerOpen, setIsQueueDrawerOpen]);

  if (!isQueueDrawerOpen) return null;

  const handleSaveQueueAsPlaylist = async () => {
    if (visibleQueue.length === 0) return;
    const name = `Queue Mix (${new Date().toLocaleDateString()})`;
    const pl = await createPlaylist(name, 'Saved from playback queue');
    await updatePlaylist(pl.id, { track_ids: visibleQueue.map(item => item.track.id) });
  };

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('queue_title', settings.language)}
      className="absolute top-0 bottom-[7.5rem] right-0 z-50 w-full sm:w-96 overflow-hidden rounded-bl-2xl bg-oled-card/95 border-l border-b border-brand-border backdrop-blur-xl shadow-2xl flex flex-col animate-slideInRight select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-brand-border/60">
        <div>
          <h3 className="font-semibold text-base font-display text-brand-foreground">
            {t('queue_title', settings.language)}
          </h3>
          <span className="text-xs text-brand-muted">
            {t('queue_track_count', settings.language, { count: visibleQueue.length })}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {queue.length > 0 && (
            <>
              <button
                onClick={handleSaveQueueAsPlaylist}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-accent hover:bg-oled-hover transition-colors focus-visible:outline-none"
                title={t('queue_save_as_playlist', settings.language)}
                aria-label={t('queue_save_as_playlist', settings.language)}
              >
                <Save className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={clearQueue}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-rose-400 hover:bg-oled-hover transition-colors focus-visible:outline-none"
                title={t('queue_clear', settings.language)}
                aria-label={t('queue_clear', settings.language)}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </>
          )}

          <button
            onClick={() => setIsQueueDrawerOpen(false)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none"
            aria-label="Close queue drawer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Queue List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {queue.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-brand-muted gap-2 py-12">
            <Music2 className="w-10 h-10 stroke-1" aria-hidden="true" />
            <p className="text-sm">{t('queue_empty', settings.language)}</p>
          </div>
        ) : (
          <VirtualList
            items={visibleQueue}
            rowHeight={62}
            className="h-full p-3"
            getKey={({ track, originalIndex }) => `${track.id}-${track.path}-${originalIndex}`}
            renderRow={({ track, originalIndex }, idx) => {
              const isPlaying = idx === 0 && originalIndex === displayedQueueIndex;
              return (
                <div
                  aria-current={isPlaying ? 'true' : undefined}
                  className={`group flex h-full items-center justify-between p-2.5 rounded-xl border ${
                    isPlaying
                      ? 'bg-brand-accent/10 border-brand-accent/40 shadow-sm'
                      : 'bg-oled-base/40 border-brand-border/40 hover:bg-oled-hover'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void playQueue(queue, originalIndex)}
                    className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer pr-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    aria-label={`Play ${track.title} by ${track.artist}`}
                  >
                    <div className="w-8 h-8 rounded bg-brand-primary/80 border border-brand-border flex items-center justify-center shrink-0">
                      {isPlaying ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                      ) : (
                        <span className="text-xs font-mono text-brand-muted">
                          {displayedQueueIndex >= 0 ? idx : idx + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span
                        className={`text-sm font-medium truncate ${
                          isPlaying ? 'text-brand-accent' : 'text-brand-foreground'
                        }`}
                      >
                        {track.title}
                      </span>
                      <span className="text-xs text-brand-muted truncate">{track.artist}</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      disabled={isPlaying || idx <= 1}
                      onClick={() => reorderQueue(originalIndex, originalIndex - 1)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-brand-accent/10 text-brand-muted disabled:opacity-20 focus-visible:outline-none"
                      aria-label={`Move ${track.title} up in queue`}
                    >
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      disabled={isPlaying || idx === visibleQueue.length - 1}
                      onClick={() => reorderQueue(originalIndex, originalIndex + 1)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-brand-accent/10 text-brand-muted disabled:opacity-20 focus-visible:outline-none"
                      aria-label={`Move ${track.title} down in queue`}
                    >
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => removeFromQueue(originalIndex)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-rose-950/50 text-brand-muted hover:text-rose-400 focus-visible:outline-none"
                      aria-label={`Remove ${track.title} from queue`}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
};

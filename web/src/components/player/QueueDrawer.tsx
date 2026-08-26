import React, { useEffect, useRef } from 'react';
import { X, Trash2, ArrowUp, ArrowDown, Save, Music2, Shuffle } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';
import { VirtualList } from '../common/VirtualList';
import { TrackArtwork } from '../common/TrackArtwork';

export const QueueDrawer: React.FC = () => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const {
    queue,
    queueIndex,
    status,
    toggleShuffle,
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
    requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>('[data-queue-heading]')?.focus());
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
      className="absolute top-0 bottom-[7.5rem] right-0 z-50 flex w-full flex-col overflow-hidden rounded-bl-3xl bg-oled-card/95 shadow-[-18px_18px_50px_-28px_rgba(0,0,0,0.55)] backdrop-blur-xl animate-slideInRight select-none focus:outline-none sm:w-96"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="min-w-0 pl-1">
          <h3
            data-queue-heading
            tabIndex={-1}
            className="font-semibold text-base font-display text-brand-foreground focus-visible:!outline-none focus-visible:!shadow-none"
          >
            {t('queue_title', settings.language)}
          </h3>
          <span className="mt-0.5 block text-xs text-brand-muted">
            {t('queue_track_count', settings.language, { count: visibleQueue.length })}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => void toggleShuffle()}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors focus-visible:outline-none ${
              status.shuffle ? 'bg-brand-accent/[0.14] text-brand-accent' : 'text-brand-muted hover:bg-oled-hover/80 hover:text-brand-foreground'
            }`}
            title={status.shuffle ? t('player_shuffle_off', settings.language) : t('player_shuffle_on', settings.language)}
            aria-label={status.shuffle ? t('player_shuffle_off', settings.language) : t('player_shuffle_on', settings.language)}
            aria-pressed={status.shuffle}
          >
            <Shuffle className="h-4 w-4" aria-hidden="true" />
          </button>
          {queue.length > 0 && (
            <>
              <button
                onClick={handleSaveQueueAsPlaylist}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-brand-muted transition-colors hover:bg-oled-hover/80 hover:text-brand-accent active:bg-oled-active/70 focus-visible:outline-none"
                title={t('queue_save_as_playlist', settings.language)}
                aria-label={t('queue_save_as_playlist', settings.language)}
              >
                <Save className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={clearQueue}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-brand-muted transition-colors hover:bg-rose-500/10 hover:text-rose-400 active:bg-rose-500/15 focus-visible:outline-none"
                title={t('queue_clear', settings.language)}
                aria-label={t('queue_clear', settings.language)}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </>
          )}

          <button
            onClick={() => setIsQueueDrawerOpen(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-brand-muted transition-colors hover:bg-oled-hover/80 hover:text-brand-foreground active:bg-oled-active/70 focus-visible:outline-none"
            aria-label={t('aria_close_queue', settings.language)}
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
            rowHeight={64}
            className="h-full px-3 pb-3 pt-1"
            getKey={({ track, originalIndex }) => `${track.id}-${track.path}-${originalIndex}`}
            renderRow={({ track, originalIndex }, idx) => {
              const isPlaying = idx === 0 && originalIndex === displayedQueueIndex;
              return (
                <div
                  aria-current={isPlaying ? 'true' : undefined}
                  className={`group flex h-[calc(100%-6px)] items-center justify-between rounded-xl px-2.5 transition-[background-color,box-shadow] duration-150 ${
                    isPlaying
                      ? 'bg-brand-accent/[0.14] shadow-md'
                      : 'bg-oled-base/30 shadow-[0_8px_24px_-22px_rgba(0,0,0,0.65)] hover:bg-oled-hover/75'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void playQueue(queue, originalIndex)}
                    className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer pr-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    aria-label={`Play ${track.title} by ${track.artist}`}
                  >
                    <div
                      className={`relative h-8 w-8 shrink-0 overflow-hidden rounded-lg ${
                        isPlaying ? 'ring-2 ring-brand-accent/70 ring-offset-1 ring-offset-oled-card' : ''
                      }`}
                    >
                      <TrackArtwork
                        track={track}
                        className="h-full w-full bg-brand-primary/55"
                        iconClassName="h-3.5 w-3.5 text-brand-muted"
                        alt={`${track.title} cover`}
                      />
                      {isPlaying && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                          <Music2 className="h-3.5 w-3.5" aria-hidden="true" />
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
                  <div className="flex shrink-0 items-center">
                    <button
                      disabled={isPlaying || idx <= 1}
                      onClick={() => reorderQueue(originalIndex, originalIndex - 1)}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-brand-muted transition-colors hover:bg-brand-accent/10 hover:text-brand-foreground active:bg-brand-accent/15 disabled:opacity-20 focus-visible:outline-none"
                      aria-label={`Move ${track.title} up in queue`}
                    >
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      disabled={isPlaying || idx === visibleQueue.length - 1}
                      onClick={() => reorderQueue(originalIndex, originalIndex + 1)}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-brand-muted transition-colors hover:bg-brand-accent/10 hover:text-brand-foreground active:bg-brand-accent/15 disabled:opacity-20 focus-visible:outline-none"
                      aria-label={`Move ${track.title} down in queue`}
                    >
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => removeFromQueue(originalIndex)}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-brand-muted transition-colors hover:bg-rose-500/10 hover:text-rose-400 active:bg-rose-500/15 focus-visible:outline-none"
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

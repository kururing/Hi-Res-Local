import React from 'react';
import { X, Trash2, ArrowUp, ArrowDown, Save, Music2 } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';

export const QueueDrawer: React.FC = () => {
  const {
    queue,
    queueIndex,
    playTrack,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    isQueueDrawerOpen,
    setIsQueueDrawerOpen,
  } = usePlayer();

  const { createPlaylist, updatePlaylist } = usePlaylists();
  const { settings } = useSettings();

  if (!isQueueDrawerOpen) return null;

  const handleSaveQueueAsPlaylist = async () => {
    if (queue.length === 0) return;
    const name = `Queue Mix (${new Date().toLocaleDateString()})`;
    const pl = await createPlaylist(name, 'Saved from playback queue');
    await updatePlaylist(pl.id, { track_ids: queue.map(t => t.id) });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('queue_title', settings.language)}
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-oled-card/95 border-l border-brand-border backdrop-blur-xl shadow-2xl flex flex-col animate-slideInRight select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-brand-border/60">
        <div>
          <h3 className="font-semibold text-base font-display text-brand-foreground">
            {t('queue_title', settings.language)}
          </h3>
          <span className="text-xs text-brand-muted">
            {t('queue_track_count', settings.language, { count: queue.length })}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {queue.length > 0 && (
            <>
              <button
                onClick={handleSaveQueueAsPlaylist}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-accent hover:bg-oled-hover transition-colors focus-visible:outline-none"
                title={t('queue_save_as_playlist', settings.language)}
                aria-label={t('queue_save_as_playlist', settings.language)}
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={clearQueue}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-brand-muted hover:text-rose-400 hover:bg-oled-hover transition-colors focus-visible:outline-none"
                title={t('queue_clear', settings.language)}
                aria-label={t('queue_clear', settings.language)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            onClick={() => setIsQueueDrawerOpen(false)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-foreground hover:bg-oled-hover transition-colors focus-visible:outline-none"
            aria-label="Close queue drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {queue.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-brand-muted gap-2 py-12">
            <Music2 className="w-10 h-10 stroke-1" />
            <p className="text-sm">{t('queue_empty', settings.language)}</p>
          </div>
        ) : (
          queue.map((track, idx) => {
            const isPlaying = idx === queueIndex;
            return (
              <div
                key={`${track.id}-${idx}`}
                className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                  isPlaying
                    ? 'bg-brand-accent/10 border-brand-accent/40 shadow-sm'
                    : 'bg-oled-base/40 border-brand-border/40 hover:bg-oled-hover'
                }`}
              >
                {/* Track Info */}
                <div
                  onClick={() => playTrack(track)}
                  className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer pr-2"
                >
                  <div className="w-8 h-8 rounded bg-indigo-950/80 border border-brand-border flex items-center justify-center shrink-0">
                    {isPlaying ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                    ) : (
                      <span className="text-xs font-mono text-brand-muted">{idx + 1}</span>
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
                </div>

                {/* Actions & Reorder */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Move Up */}
                  <button
                    disabled={idx === 0}
                    onClick={() => reorderQueue(idx, idx - 1)}
                    className="p-1.5 rounded hover:bg-white/10 text-brand-muted disabled:opacity-20 transition-opacity focus-visible:outline-none"
                    aria-label="Move up in queue"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>

                  {/* Move Down */}
                  <button
                    disabled={idx === queue.length - 1}
                    onClick={() => reorderQueue(idx, idx + 1)}
                    className="p-1.5 rounded hover:bg-white/10 text-brand-muted disabled:opacity-20 transition-opacity focus-visible:outline-none"
                    aria-label="Move down in queue"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>

                  {/* Remove */}
                  <button
                    onClick={() => removeFromQueue(idx)}
                    className="p-1.5 rounded hover:bg-rose-950/50 text-brand-muted hover:text-rose-400 transition-colors focus-visible:outline-none"
                    aria-label="Remove from queue"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

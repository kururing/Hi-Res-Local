import React from 'react';
import { History as HistoryIcon, Play, Trash2, Clock } from 'lucide-react';
import { Storage, HistoryItem } from '../../services/storage';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { t } from '../../i18n';

interface HistoryViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = () => {
  const [historyItems, setHistoryItems] = React.useState<HistoryItem[]>(() => Storage.getHistory());
  const { getTrackById } = useLibrary();
  const { playTrack, status } = usePlayer();
  const { settings } = useSettings();

  const clearHistory = () => {
    localStorage.removeItem('nghenhac_history_v2');
    setHistoryItems([]);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto w-full select-none">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground flex items-center gap-2.5">
            <HistoryIcon className="w-6 h-6 text-brand-accent" />
            <span>{t('nav_history', settings.language)}</span>
          </h1>
          <span className="text-xs text-brand-muted">
            {historyItems.length} songs played recently
          </span>
        </div>

        {historyItems.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="w-4 h-4" />}
            onClick={clearHistory}
          >
            Clear History
          </Button>
        )}
      </div>

      {historyItems.length === 0 ? (
        <div className="p-16 rounded-2xl bg-oled-card/50 border border-brand-border/60 text-center text-brand-muted flex flex-col items-center gap-3">
          <Clock className="w-10 h-10 stroke-1" />
          <p className="text-sm">No listening history recorded yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
          {historyItems.map((item, idx) => {
            const track = getTrackById(item.track_id);
            if (!track) return null;
            const isPlaying = status.current_track?.id === track.id;

            return (
              <div
                key={`${item.track_id}-${item.played_at}-${idx}`}
                onDoubleClick={() => playTrack(track)}
                className={`flex items-center justify-between px-4 py-3 text-xs transition-colors cursor-pointer ${
                  isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <button
                    onClick={() => playTrack(track)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-brand-muted hover:text-brand-accent hover:bg-oled-base transition-all"
                  >
                    {isPlaying ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold truncate">{track.title}</span>
                    <span className="text-[11px] text-brand-muted truncate">
                      {track.artist} • {track.album}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge track={track} />
                  <span className="font-mono text-brand-muted text-[11px]">
                    {new Date(item.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

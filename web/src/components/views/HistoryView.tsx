import React from 'react';
import { History as HistoryIcon, Trash2, Clock } from 'lucide-react';
import { PlayHistoryEntry } from '../../types/ipc';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { TrackPlayArtwork } from '../common/TrackPlayArtwork';
import { t } from '../../i18n';
import { TrackMoreButton } from '../common/TrackMoreButton';
import { usePlatform } from '../../platform';

interface HistoryViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onNavigate }) => {
  const [historyItems, setHistoryItems] = React.useState<PlayHistoryEntry[]>([]);
  const { playTrack, status } = usePlayer();
  const { settings } = useSettings();
  const { albums, artists } = useLibrary();
  const { history } = usePlatform();

  React.useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      const entries = await history.list({ limit: 100, offset: 0 });
      if (!cancelled) setHistoryItems(entries);
    };

    void loadHistory();
    const handleUpdate = () => { void loadHistory(); };
    window.addEventListener('nghenhac:history-updated', handleUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('nghenhac:history-updated', handleUpdate);
    };
  }, [history]);

  const clearHistory = async () => {
    if (!window.confirm(t('history_clear_confirm', settings.language))) return;
    await history.clear();
    setHistoryItems([]);
  };

  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-6 p-6 select-none md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground flex items-center gap-2.5">
            <HistoryIcon className="w-6 h-6 text-brand-accent" />
            <span>{t('nav_history', settings.language)}</span>
          </h1>
          <span className="text-xs text-brand-muted">
            {t('history_subtitle', settings.language, { count: historyItems.length })}
          </span>
        </div>

        {historyItems.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="w-4 h-4" />}
            onClick={clearHistory}
          >
            {t('history_clear', settings.language)}
          </Button>
        )}
      </div>

      {historyItems.length === 0 ? (
        <div className="p-16 rounded-2xl bg-oled-card/50 border border-brand-border/60 text-center text-brand-muted flex flex-col items-center gap-3">
          <Clock className="w-10 h-10 stroke-1" />
          <p className="text-sm">{t('history_empty', settings.language)}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
          {historyItems.map((item, idx) => {
            const track = item.track;
            if (!track) return null;
            const isPlaying = status.current_track?.id === track.id;

            return (
              <div
                key={`${item.track_id}-${item.played_at}-${idx}`}
                onDoubleClick={() => playTrack(track)}
                className={`history-row-grid group grid items-center gap-3 px-4 py-2.5 text-xs transition-colors cursor-pointer ${
                  isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                }`}
              >
                <div className="flex items-center justify-center">
                  <TrackPlayArtwork
                    track={track}
                    isPlaying={isPlaying}
                    onPlay={() => playTrack(track)}
                  />
                </div>

                <span className="min-w-0 truncate font-semibold" title={track.title}>
                  {track.title}
                </span>

                <button type="button" className="min-w-0 truncate text-left text-brand-muted hover:text-brand-accent" title={track.artist} onClick={e => { e.stopPropagation(); const target = artists.find(item => item.name === track.artist); if (target) onNavigate('artist_detail', target); }}>
                  {track.artist}
                </button>

                <button type="button" className="hidden min-w-0 truncate text-left text-brand-muted hover:text-brand-accent xl:block" title={track.album} onClick={e => { e.stopPropagation(); const target = albums.find(item => item.name === track.album && item.artist === track.artist); if (target) onNavigate('album_detail', target); }}>
                  {track.album}
                </button>

                <div className="flex min-w-0 items-center justify-end">
                  <Badge track={track} />
                </div>

                <span className="text-right font-mono text-[11px] tabular-nums text-brand-muted">
                  {new Date(item.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                <TrackMoreButton
                  track={track}
                  onNavigateAlbum={() => { const target = albums.find(item => item.name === track.album && item.artist === track.artist); if (target) onNavigate('album_detail', target); }}
                  onNavigateArtist={() => { const target = artists.find(item => item.name === track.artist); if (target) onNavigate('artist_detail', target); }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

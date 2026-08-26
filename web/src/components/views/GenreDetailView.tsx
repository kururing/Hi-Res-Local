import React from 'react';
import { Radio, Play, Shuffle, ArrowLeft } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { TrackPlayArtwork } from '../common/TrackPlayArtwork';
import { Genre, Track } from '../../types/library';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';

interface GenreDetailViewProps {
  genre: Genre;
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails?: (track: Track) => void;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const GenreDetailView: React.FC<GenreDetailViewProps> = ({
  genre,
  onNavigate,
}) => {
  const { tracks, albums, artists } = useLibrary();
  const { playTrack, playQueue, toggleShuffle, status } = usePlayer();
  const { settings } = useSettings();

  const genreTracks = React.useMemo(() => {
    return tracks.filter(t => (t.genre || 'Other').toLowerCase() === genre.name.toLowerCase());
  }, [tracks, genre.name]);

  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-8 p-6 select-none md:p-8">
      <button
        onClick={() => onNavigate('genres')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-foreground transition-colors focus-visible:outline-none"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{t('nav_back_to_genres', settings.language)}</span>
      </button>

      {/* Header Banner */}
      <div className={`p-8 rounded-2xl bg-gradient-to-r ${genre.color_gradient} border border-brand-border/80 shadow-card-elevated flex flex-col gap-3`}>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/80">
          <Radio className="w-4 h-4" />
          <span>{t('detail_genre_label', settings.language)}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold font-display text-white">
          {genre.name}
        </h1>
        <span className="text-xs text-white/90 font-mono">
          {t('genre_tracks_count', settings.language, { count: genreTracks.length })}
        </span>

        <div className="flex items-center gap-3 mt-4">
          <Button
            variant="accent"
            size="md"
            icon={<Play className="w-4 h-4 fill-current" />}
            onClick={() => genreTracks.length > 0 && playQueue(genreTracks, 0)}
          >
            {t('detail_play_genre', settings.language)}
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<Shuffle className="w-4 h-4" />}
            onClick={() => {
              if (!status.shuffle) void toggleShuffle();
              playQueue(genreTracks, 0);
            }}
          >
            Shuffle
          </Button>
        </div>
      </div>

      {/* Track List */}
      <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
        {genreTracks.map(tr => {
          const isPlaying = status.current_track?.id === tr.id;
          return (
            <div
              key={tr.id}
              onDoubleClick={() => playTrack(tr, genreTracks)}
              className={`flex items-center justify-between px-4 py-3 text-xs transition-colors cursor-pointer ${
                isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <TrackPlayArtwork
                  track={tr}
                  isPlaying={isPlaying}
                  onPlay={() => playTrack(tr, genreTracks)}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold truncate">{tr.title}</span>
                  <div className="flex min-w-0 items-center gap-1 text-[11px] text-brand-muted truncate">
                    <button type="button" className="truncate hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = artists.find(item => item.name === tr.artist); if (target) onNavigate('artist_detail', target); }}>{tr.artist}</button>
                    <span>•</span>
                    <button type="button" className="truncate hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}>{tr.album}</button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Badge track={tr} />
                <span className="font-mono text-brand-muted">{formatDuration(tr.duration)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

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
import { TrackMoreButton } from '../common/TrackMoreButton';

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
  onOpenDetails,
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
              className={`tracks-table-grid group grid items-center gap-3 px-4 py-3 text-xs transition-colors cursor-pointer ${
                isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
              }`}
            >
              <div className="flex items-center justify-center">
                <TrackPlayArtwork
                  track={tr}
                  isPlaying={isPlaying}
                  onPlay={() => playTrack(tr, genreTracks)}
                />
              </div>

              <div className="min-w-0 truncate font-semibold">{tr.title}</div>

              <div className="hidden min-w-0 sm:block truncate text-brand-muted">
                <button type="button" className="max-w-full truncate text-left hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = artists.find(item => item.name === tr.artist); if (target) onNavigate('artist_detail', target); }}>{tr.artist}</button>
              </div>

              <div className="hidden min-w-0 md:block truncate text-brand-muted">
                <button type="button" className="max-w-full truncate text-left hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}>{tr.album}</button>
              </div>

              <div className="hidden min-w-0 min-[1180px]:flex items-center">
                <Badge track={tr} />
              </div>

              <div className="flex items-center justify-end gap-3">
                <span className="font-mono text-brand-muted">{formatDuration(tr.duration)}</span>
                <TrackMoreButton
                  track={tr}
                  onOpenDetails={onOpenDetails}
                  onNavigateAlbum={() => { const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}
                  onNavigateArtist={() => { const target = artists.find(item => item.name === tr.artist); if (target) onNavigate('artist_detail', target); }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React from 'react';
import { Radio, Play, Shuffle, ArrowLeft } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Genre, Track } from '../../types/library';

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
  const { tracks } = useLibrary();
  const { playTrack, playQueue, status } = usePlayer();

  const genreTracks = React.useMemo(() => {
    return tracks.filter(t => (t.genre || 'Other').toLowerCase() === genre.name.toLowerCase());
  }, [tracks, genre.name]);

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto w-full select-none">
      <button
        onClick={() => onNavigate('genres')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-foreground transition-colors focus-visible:outline-none"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Genres</span>
      </button>

      {/* Header Banner */}
      <div className={`p-8 rounded-2xl bg-gradient-to-r ${genre.color_gradient} border border-white/20 shadow-card-elevated flex flex-col gap-3`}>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/80">
          <Radio className="w-4 h-4" />
          <span>Genre</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold font-display text-white">
          {genre.name}
        </h1>
        <span className="text-xs text-white/90 font-mono">
          {genreTracks.length} tracks
        </span>

        <div className="flex items-center gap-3 mt-4">
          <Button
            variant="accent"
            size="md"
            icon={<Play className="w-4 h-4 fill-current" />}
            onClick={() => genreTracks.length > 0 && playQueue(genreTracks, 0)}
          >
            Play Genre
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<Shuffle className="w-4 h-4" />}
            onClick={() => {
              const shuffled = [...genreTracks].sort(() => Math.random() - 0.5);
              playQueue(shuffled, 0);
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
                <button
                  onClick={() => playTrack(tr, genreTracks)}
                  className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-brand-muted hover:text-brand-accent hover:bg-oled-base transition-all focus-visible:outline-none"
                  aria-label={`Play ${tr.title}`}
                >
                  {isPlaying ? (
                    <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" aria-hidden="true" />
                  )}
                </button>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold truncate">{tr.title}</span>
                  <span className="text-[11px] text-brand-muted truncate">
                    {tr.artist} • {tr.album}
                  </span>
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

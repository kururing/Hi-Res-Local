import React from 'react';
import { Play } from 'lucide-react';
import { Track } from '../../types/library';
import { TrackArtwork } from './TrackArtwork';

interface TrackPlayArtworkProps {
  track: Track;
  isPlaying: boolean;
  onPlay: () => void;
  className?: string;
}

export const TrackPlayArtwork: React.FC<TrackPlayArtworkProps> = ({
  track,
  isPlaying,
  onPlay,
  className = '',
}) => (
  <button
    type="button"
    onClick={event => {
      event.stopPropagation();
      onPlay();
    }}
    className={`group/artwork relative h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 overflow-hidden rounded-lg border border-brand-border bg-brand-primary/70 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${className}`}
    aria-label={`Play ${track.title}`}
  >
    <TrackArtwork
      track={track}
      className="absolute inset-0"
      imageClassName="motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover/artwork:scale-105"
      iconClassName="h-5 w-5 text-brand-muted transition-colors group-hover/artwork:text-brand-accent"
      alt=""
    />
    <span
      className={`absolute inset-0 flex items-center justify-center text-white transition-colors ${
        isPlaying
          ? 'bg-black/40'
          : 'bg-black/0 group-hover/artwork:bg-black/45 group-focus-visible/artwork:bg-black/45'
      }`}
      aria-hidden="true"
    >
      {isPlaying ? (
        <span className="h-2.5 w-2.5 rounded-full bg-brand-accent shadow-[0_0_0_4px_rgba(var(--color-accent)/0.22)] motion-safe:animate-pulse" />
      ) : (
        <Play className="h-4 w-4 translate-x-px fill-current opacity-0 transition-opacity group-hover/artwork:opacity-100 group-focus-visible/artwork:opacity-100" />
      )}
    </span>
  </button>
);

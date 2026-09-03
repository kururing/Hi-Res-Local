import React, { useEffect, useState } from 'react';
import { ListMusic, Sparkles } from 'lucide-react';
import { Playlist } from '../../types/playlist';
import { Track } from '../../types/library';
import { usePlatform } from '../../platform';
import { TrackArtwork } from './TrackArtwork';

interface PlaylistArtworkProps {
  playlist: Playlist;
  tracks: Track[];
  className?: string;
}

export const PlaylistArtwork: React.FC<PlaylistArtworkProps> = ({ playlist, tracks, className = '' }) => {
  const { artworkAssets } = usePlatform();
  const [coverSource, setCoverSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cover = playlist.cover_url;
    if (!cover) {
      setCoverSource(null);
      return () => { cancelled = true; };
    }

    void artworkAssets.resolveDisplaySource(cover)
      .then(resolved => {
        if (!cancelled) setCoverSource(resolved);
      })
      .catch(() => {
        if (!cancelled) setCoverSource(null);
      });

    return () => { cancelled = true; };
  }, [artworkAssets, playlist.cover_url]);

  if (coverSource) {
    return (
      <img
        src={coverSource}
        alt={`${playlist.name} cover`}
        referrerPolicy="no-referrer"
        className={`h-full w-full object-cover ${className}`}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setCoverSource(null)}
      />
    );
  }

  const coverTracks = tracks.slice(0, 4);
  if (coverTracks.length > 0) {
    if (coverTracks.length < 4) {
      return (
        <div className={`h-full w-full overflow-hidden ${className}`}>
          <TrackArtwork
            track={coverTracks[0]}
            className="h-full w-full"
            iconClassName="h-5 w-5 text-brand-muted/70"
          />
        </div>
      );
    }

    return (
      <div className={`grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
        {[0, 1, 2, 3].map(index => (
          <TrackArtwork
            key={`${coverTracks[index]?.id ?? 'empty'}-${index}`}
            track={coverTracks[index] ?? null}
            className="min-h-0 min-w-0 border border-black/10"
            iconClassName="h-5 w-5 text-brand-muted/70"
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full items-center justify-center bg-gradient-to-tr from-brand-primary to-oled-card ${className}`}>
      {playlist.is_smart ? <Sparkles className="h-1/2 w-1/2 text-amber-400" /> : <ListMusic className="h-1/2 w-1/2 text-brand-accent" />}
    </div>
  );
};

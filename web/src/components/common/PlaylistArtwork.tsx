import React, { useEffect, useState } from 'react';
import { ListMusic, Sparkles } from 'lucide-react';
import { Playlist } from '../../types/playlist';
import { Track } from '../../types/library';
import { isTauri } from '../../services/ipc';
import { TrackArtwork } from './TrackArtwork';

interface PlaylistArtworkProps {
  playlist: Playlist;
  tracks: Track[];
  className?: string;
}

export const PlaylistArtwork: React.FC<PlaylistArtworkProps> = ({ playlist, tracks, className = '' }) => {
  const [coverSource, setCoverSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cover = playlist.cover_url;
    if (!cover) {
      setCoverSource(null);
    } else if (/^(data:|blob:|https?:\/\/)/i.test(cover)) {
      setCoverSource(cover);
    } else if (isTauri()) {
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        if (!cancelled) setCoverSource(convertFileSrc(cover));
      });
    } else {
      setCoverSource(null);
    }
    return () => { cancelled = true; };
  }, [playlist.cover_url]);

  if (coverSource) {
    return <img src={coverSource} alt={`${playlist.name} cover`} className={`h-full w-full object-cover ${className}`} draggable={false} onError={() => setCoverSource(null)} />;
  }

  const coverTracks = tracks.slice(0, 4);
  if (coverTracks.length > 0) {
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

import React, { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';
import { Track } from '../../types/library';
import { isTauri } from '../../services/ipc';
import { getCachedArtwork } from '../../services/remoteArtwork';

interface TrackArtworkProps {
  track: Track | null;
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
  alt?: string;
}

export const TrackArtwork: React.FC<TrackArtworkProps> = ({
  track,
  className = '',
  imageClassName = '',
  iconClassName = 'w-6 h-6 text-brand-muted',
  alt,
}) => {
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = track?.cover_art_path;
    setFailed(false);

    if (!path) {
      setSource(track ? getCachedArtwork('album', track.artist, track.album) : null);
    } else if (/^(data:|blob:|https?:\/\/)/i.test(path)) {
      setSource(path);
    } else if (isTauri()) {
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        if (!cancelled) setSource(convertFileSrc(path));
      });
    } else {
      setSource(null);
    }

    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.cover_art_path, track?.artist, track?.album]);

  return (
    <div className={`overflow-hidden flex items-center justify-center ${className}`}>
      {source && !failed ? (
        <img
          src={source}
          alt={alt ?? `${track?.title ?? 'Track'} cover`}
          className={`w-full h-full object-cover ${imageClassName}`}
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        <Music2 className={iconClassName} aria-hidden="true" />
      )}
    </div>
  );
};

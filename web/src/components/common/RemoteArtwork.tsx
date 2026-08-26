import React, { useEffect, useState } from 'react';
import { Music2, User } from 'lucide-react';
import { getCachedArtwork } from '../../services/remoteArtwork';

interface RemoteArtworkProps {
  kind: 'album' | 'artist';
  artist: string;
  album?: string;
  className?: string;
  alt: string;
}

export const RemoteArtwork: React.FC<RemoteArtworkProps> = ({ kind, artist, album, className = '', alt }) => {
  const source = getCachedArtwork(kind, artist, album);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  return (
    <div className={`flex h-full w-full items-center justify-center overflow-hidden ${className}`}>
      {source && !failed ? (
        <img src={source} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} draggable={false} />
      ) : kind === 'artist' ? (
        <User className="h-12 w-12 text-brand-accent/60" aria-hidden="true" />
      ) : (
        <Music2 className="h-12 w-12 text-brand-accent/40" aria-hidden="true" />
      )}
    </div>
  );
};

import React from 'react';
import { getCachedArtwork } from '../../services/remoteArtwork';
import { Album } from '../../types/library';
import { RemoteArtwork } from './RemoteArtwork';
import { TrackArtwork } from './TrackArtwork';

interface AlbumArtworkProps {
  album: Album;
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
  alt?: string;
}

/** Uses the cached album art first, then embedded art from any track in the album. */
export const AlbumArtwork: React.FC<AlbumArtworkProps> = ({
  album,
  className = '',
  imageClassName = '',
  iconClassName,
  alt,
}) => {
  const cachedAlbumArtwork = getCachedArtwork('album', album.artist, album.name);
  if (cachedAlbumArtwork) {
    return (
      <RemoteArtwork
        kind="album"
        artist={album.artist}
        album={album.name}
        className={className}
        alt={alt ?? `${album.name} cover`}
        fallback={(
          <TrackArtwork
            track={album.tracks.find(track => track.cover_art_path) ?? album.tracks[0] ?? null}
            className="h-full w-full"
            imageClassName={imageClassName}
            iconClassName={iconClassName}
            alt={alt ?? `${album.name} cover`}
          />
        )}
      />
    );
  }

  const embeddedTrack = album.tracks.find(track => track.cover_art_path) ?? album.tracks[0] ?? null;
  return (
    <TrackArtwork
      track={embeddedTrack}
      className={className}
      imageClassName={imageClassName}
      iconClassName={iconClassName}
      alt={alt ?? `${album.name} cover`}
    />
  );
};

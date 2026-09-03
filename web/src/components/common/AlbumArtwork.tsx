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

/** Prefers catalog/embedded cover over iTunes cache so admin-uploaded art is not overwritten. */
export const AlbumArtwork: React.FC<AlbumArtworkProps> = ({
  album,
  className = '',
  imageClassName = '',
  iconClassName,
  alt,
}) => {
  const catalogTrack = album.tracks.find(track => track.cover_art_path) ?? null;
  const catalogCover = album.cover_url || catalogTrack?.cover_art_path || null;
  if (catalogCover) {
    return (
      <TrackArtwork
        track={catalogTrack ?? {
          id: album.id,
          title: album.name,
          artist: album.artist,
          album: album.name,
          duration: 0,
          path: '',
          date_added: '',
          cover_art_path: catalogCover,
        }}
        className={className}
        imageClassName={imageClassName}
        iconClassName={iconClassName}
        alt={alt ?? `${album.name} cover`}
      />
    );
  }

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
            track={album.tracks[0] ?? null}
            className="h-full w-full"
            imageClassName={imageClassName}
            iconClassName={iconClassName}
            alt={alt ?? `${album.name} cover`}
          />
        )}
      />
    );
  }

  return (
    <TrackArtwork
      track={album.tracks[0] ?? null}
      className={className}
      imageClassName={imageClassName}
      iconClassName={iconClassName}
      alt={alt ?? `${album.name} cover`}
    />
  );
};

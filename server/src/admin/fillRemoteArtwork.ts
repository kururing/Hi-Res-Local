import type { Pool } from 'pg';
import { AdminCatalogRepository } from './catalogRepository.js';
import { isUnknownAlbumTitle, isUnknownArtistName } from './importMetadata.js';
import { artworkUrlsMatch, isArtistPortraitUrl, isItunesAlbumArtworkUrl, type RemoteArtworkLookup } from '../ingestion/remoteArtwork.js';

export async function fillCatalogRemoteArtwork(
  pool: Pool,
  lookup: RemoteArtworkLookup | undefined,
  artistId: string | null,
  albumId: string | null,
  onError?: (error: unknown) => void,
): Promise<void> {
  if (!lookup) return;
  const catalog = new AdminCatalogRepository(pool);
  try {
    await fillAlbumCover(catalog, lookup, albumId);
  } catch (error) {
    onError?.(error);
  }
  try {
    await fillArtistPortrait(catalog, lookup, artistId, albumId);
  } catch (error) {
    onError?.(error);
  }
}

async function fillAlbumCover(
  catalog: AdminCatalogRepository,
  lookup: RemoteArtworkLookup,
  albumId: string | null,
): Promise<void> {
  if (!albumId) return;
  const album = await catalog.getAlbum(albumId);
  if (!album || album.cover_art_url?.trim() || isUnknownAlbumTitle(album.title)) return;
  const url = await lookup.lookupAlbumCover(album.artist_name ?? '', album.title);
  if (url) await catalog.updateAlbum(albumId, { coverArtUrl: url });
}

async function fillArtistPortrait(
  catalog: AdminCatalogRepository,
  lookup: RemoteArtworkLookup,
  artistId: string | null,
  albumId: string | null,
): Promise<void> {
  if (!artistId) return;
  const artist = await catalog.getArtist(artistId);
  if (!artist || isUnknownArtistName(artist.name)) return;
  const album = albumId ? await catalog.getAlbum(albumId) : null;
  const albumCover = album?.cover_art_url?.trim() || null;
  const current = artist.image_url?.trim() || null;
  const copiedAlbumCover = Boolean(
    current && (
      isItunesAlbumArtworkUrl(current)
      || (albumCover && artworkUrlsMatch(current, albumCover))
      || await catalog.artistImageMatchesOwnAlbumCover(artistId, current)
    ),
  );
  if (current && !copiedAlbumCover) return;
  const albumHint = album && !isUnknownAlbumTitle(album.title)
    ? album.title
    : await catalog.findRepresentativeAlbumTitle(artistId);
  const url = await lookup.lookupArtistPortrait(artist.name, albumHint ?? undefined);
  if (url && isArtistPortraitUrl(url) && !(albumCover && artworkUrlsMatch(url, albumCover))) {
    await catalog.updateArtist(artistId, { imageUrl: url });
    return;
  }
  if (copiedAlbumCover) await catalog.updateArtist(artistId, { imageUrl: null });
}

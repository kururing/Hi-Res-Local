import type { FavoriteAlbum } from '../../types/ipc';
import type { FavoritesApi, PlatformCommandGateway } from '../contracts';

/** IPC-backed favorites adapter for the Tauri desktop runtime. */
export class IpcFavoritesApi implements FavoritesApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  setTrackFavorite(trackId: string, favorite: boolean): Promise<void> {
    return this.commands.invoke('set_track_favorite', { id: trackId, isFavorite: favorite });
  }

  setAlbumFavorite(albumTitle: string, artistName: string, favorite: boolean): Promise<void> {
    return this.commands.invoke('set_album_favorite', { albumTitle, artistName, isFavorite: favorite });
  }

  setArtistFavorite(artistName: string, favorite: boolean): Promise<void> {
    return this.commands.invoke('set_artist_favorite', { artistName, isFavorite: favorite });
  }

  getFavoriteAlbums(): Promise<FavoriteAlbum[]> {
    return this.commands.invoke('get_favorite_albums');
  }

  getFavoriteArtists(): Promise<string[]> {
    return this.commands.invoke('get_favorite_artists');
  }
}

export class TauriFavoritesApi extends IpcFavoritesApi {}

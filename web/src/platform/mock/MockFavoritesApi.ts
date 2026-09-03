import type { FavoriteAlbum } from '../../types/ipc';
import type { FavoritesApi } from '../contracts';
import type { MockDataStore } from './MockDataStore';

/** Direct in-memory favorites adapter sharing track flags with the library store. */
export class MockFavoritesApi implements FavoritesApi {
  constructor(private readonly store: MockDataStore) {}

  setTrackFavorite(trackId: string, favorite: boolean): Promise<void> {
    this.store.setTrackFavorite(trackId, favorite);
    return Promise.resolve();
  }

  setAlbumFavorite(albumTitle: string, artistName: string, favorite: boolean): Promise<void> {
    this.store.setAlbumFavorite(albumTitle, artistName, favorite);
    return Promise.resolve();
  }

  setArtistFavorite(artistName: string, favorite: boolean): Promise<void> {
    this.store.setArtistFavorite(artistName, favorite);
    return Promise.resolve();
  }

  getFavoriteAlbums(): Promise<FavoriteAlbum[]> {
    return Promise.resolve(this.store.getFavoriteAlbums());
  }

  getFavoriteArtists(): Promise<string[]> {
    return Promise.resolve(this.store.getFavoriteArtists());
  }
}

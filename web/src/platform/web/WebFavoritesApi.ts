import type { CloudApiClient } from '../../api/client';
import type { FavoriteAlbum } from '../../types/ipc';
import type { FavoritesApi } from '../contracts';

function favoriteMethod(favorite: boolean): 'PUT' | 'DELETE' {
  return favorite ? 'PUT' : 'DELETE';
}

/**
 * Browser cloud runtime. Favorite mutations use PUT to favorite and DELETE
 * to unfavorite. Local filesystem paths are never included in requests.
 */
export class WebFavoritesApi implements FavoritesApi {
  constructor(private readonly cloud: CloudApiClient) {}

  setTrackFavorite(trackId: string, favorite: boolean): Promise<void> {
    return this.cloud.request<void>(`/v1/favorites/tracks/${encodeURIComponent(trackId)}`, {
      method: favoriteMethod(favorite),
    });
  }

  setAlbumFavorite(albumTitle: string, artistName: string, favorite: boolean): Promise<void> {
    return this.cloud.request<void>('/v1/favorites/albums', {
      method: favoriteMethod(favorite),
      body: { album_title: albumTitle, artist_name: artistName },
    });
  }

  setArtistFavorite(artistName: string, favorite: boolean): Promise<void> {
    return this.cloud.request<void>('/v1/favorites/artists', {
      method: favoriteMethod(favorite),
      body: { artist_name: artistName },
    });
  }

  async getFavoriteAlbums(): Promise<FavoriteAlbum[]> {
    const payload = await this.cloud.request<FavoriteAlbum[]>('/v1/favorites/albums');
    if (!Array.isArray(payload)) {
      throw new Error('Cloud favorite albums response was not an array.');
    }
    return payload;
  }

  async getFavoriteArtists(): Promise<string[]> {
    const payload = await this.cloud.request<string[]>('/v1/favorites/artists');
    if (!Array.isArray(payload)) {
      throw new Error('Cloud favorite artists response was not an array.');
    }
    return payload;
  }
}

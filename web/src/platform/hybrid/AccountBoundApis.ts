import type { FavoriteAlbum, PlayHistoryEntry, PlaylistDetails } from '../../types/ipc';
import type {
  CreatePlaylistInput,
  FavoritesApi,
  HistoryApi,
  HistoryListOptions,
  PlaylistApi,
  RecordPlayInput,
  UpdatePlaylistInput,
} from '../contracts';

/**
 * Account-owned music domains go through the cloud API (PostgreSQL).
 * Unsigned desktop keeps listening locally but does not use SQLite as a
 * business database for playlists, favorites, or history.
 */
export class AccountBoundPlaylistApi implements PlaylistApi {
  constructor(
    private readonly cloud: PlaylistApi,
    private readonly isAuthenticated: () => boolean,
  ) {}

  list() {
    if (!this.isAuthenticated()) return Promise.resolve([]);
    return this.cloud.list();
  }

  get(id: string): Promise<PlaylistDetails> {
    this.requireAccount();
    return this.cloud.get(id);
  }

  create(input: CreatePlaylistInput) {
    this.requireAccount();
    return this.cloud.create(input);
  }

  update(input: UpdatePlaylistInput) {
    this.requireAccount();
    return this.cloud.update(input);
  }

  delete(id: string) {
    this.requireAccount();
    return this.cloud.delete(id);
  }

  addTracks(playlistId: string, trackIds: string[]) {
    this.requireAccount();
    return this.cloud.addTracks(playlistId, trackIds);
  }

  removeTracks(playlistId: string, trackIds: string[]) {
    this.requireAccount();
    return this.cloud.removeTracks(playlistId, trackIds);
  }

  reorderTracks(playlistId: string, trackIds: string[]) {
    this.requireAccount();
    return this.cloud.reorderTracks(playlistId, trackIds);
  }

  private requireAccount(): void {
    if (!this.isAuthenticated()) {
      throw new Error('Sign in to use playlists.');
    }
  }
}

export class AccountBoundFavoritesApi implements FavoritesApi {
  constructor(
    private readonly cloud: FavoritesApi,
    private readonly isAuthenticated: () => boolean,
  ) {}

  setTrackFavorite(trackId: string, favorite: boolean) {
    this.requireAccount();
    return this.cloud.setTrackFavorite(trackId, favorite);
  }

  setAlbumFavorite(albumTitle: string, artistName: string, favorite: boolean) {
    this.requireAccount();
    return this.cloud.setAlbumFavorite(albumTitle, artistName, favorite);
  }

  setArtistFavorite(artistName: string, favorite: boolean) {
    this.requireAccount();
    return this.cloud.setArtistFavorite(artistName, favorite);
  }

  getFavoriteAlbums(): Promise<FavoriteAlbum[]> {
    if (!this.isAuthenticated()) return Promise.resolve([]);
    return this.cloud.getFavoriteAlbums();
  }

  getFavoriteArtists(): Promise<string[]> {
    if (!this.isAuthenticated()) return Promise.resolve([]);
    return this.cloud.getFavoriteArtists();
  }

  private requireAccount(): void {
    if (!this.isAuthenticated()) {
      throw new Error('Sign in to use favorites.');
    }
  }
}

export class AccountBoundHistoryApi implements HistoryApi {
  constructor(
    private readonly cloud: HistoryApi,
    private readonly isAuthenticated: () => boolean,
  ) {}

  record(input: RecordPlayInput): Promise<PlayHistoryEntry> {
    if (!this.isAuthenticated()) {
      return Promise.resolve(unsignedHistoryEntry(input));
    }
    return this.cloud.record(input);
  }

  list(options?: HistoryListOptions) {
    if (!this.isAuthenticated()) return Promise.resolve([]);
    return this.cloud.list(options);
  }

  clear() {
    if (!this.isAuthenticated()) return Promise.resolve(0);
    return this.cloud.clear();
  }
}

function unsignedHistoryEntry(input: RecordPlayInput): PlayHistoryEntry {
  return {
    id: 0,
    track_id: input.track_id,
    track: null,
    played_at: new Date().toISOString(),
    completed_duration_ms: input.completed_duration_ms,
    fully_played: input.fully_played,
  };
}

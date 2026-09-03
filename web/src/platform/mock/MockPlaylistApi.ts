import type { BackendPlaylist, PlaylistDetails } from '../../types/ipc';
import type {
  CreatePlaylistInput,
  PlaylistApi,
  PlaylistCoverSelection,
  UpdatePlaylistInput,
} from '../contracts';
import type { MockDataStore } from './MockDataStore';

/**
 * Direct in-memory playlist adapter. Shares track state with library and
 * favorites through MockDataStore.
 */
export class MockPlaylistApi implements PlaylistApi {
  constructor(private readonly store: MockDataStore) {}

  list(): Promise<BackendPlaylist[]> {
    return Promise.resolve(this.store.getPlaylists().map(playlist => this.store.toBackendPlaylist(playlist)));
  }

  get(id: string): Promise<PlaylistDetails> {
    const playlist = this.store.getPlaylist(id);
    if (!playlist) return Promise.reject(new Error('Playlist not found'));
    return Promise.resolve({
      playlist: this.store.toBackendPlaylist(playlist),
      tracks: this.store.getPlaylistTracks(playlist),
    });
  }

  create(input: CreatePlaylistInput): Promise<BackendPlaylist> {
    const created = this.store.createPlaylist(input);
    return Promise.resolve(this.store.toBackendPlaylist(created));
  }

  update(input: UpdatePlaylistInput): Promise<BackendPlaylist> {
    const updated = this.store.updatePlaylist(input);
    return Promise.resolve(this.store.toBackendPlaylist(updated));
  }

  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.store.deletePlaylist(id));
  }

  addTracks(playlistId: string, trackIds: string[]): Promise<number> {
    return Promise.resolve(this.store.addTracksToPlaylist(playlistId, trackIds));
  }

  removeTracks(playlistId: string, trackIds: string[]): Promise<number> {
    return Promise.resolve(this.store.removeTracksFromPlaylist(playlistId, trackIds));
  }

  reorderTracks(playlistId: string, trackIds: string[]): Promise<void> {
    this.store.reorderPlaylistTracks(playlistId, trackIds);
    return Promise.resolve();
  }

  async pickCover(): Promise<PlaylistCoverSelection | null> {
    return null;
  }
}

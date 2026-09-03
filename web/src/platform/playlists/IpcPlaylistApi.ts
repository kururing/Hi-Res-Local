import type { BackendPlaylist, PlaylistDetails } from '../../types/ipc';
import type {
  CreatePlaylistInput,
  PlatformCommandGateway,
  PlaylistApi,
  PlaylistCoverSelection,
  UpdatePlaylistInput,
} from '../contracts';

/** IPC-backed playlist adapter for the Tauri desktop runtime. */
export class IpcPlaylistApi implements PlaylistApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  list(): Promise<BackendPlaylist[]> {
    return this.commands.invoke('get_playlists');
  }

  get(id: string): Promise<PlaylistDetails> {
    return this.commands.invoke('get_playlist', { id });
  }

  create(input: CreatePlaylistInput): Promise<BackendPlaylist> {
    return this.commands.invoke('create_playlist', { input });
  }

  update(input: UpdatePlaylistInput): Promise<BackendPlaylist> {
    return this.commands.invoke('update_playlist', { input });
  }

  delete(id: string): Promise<boolean> {
    return this.commands.invoke('delete_playlist', { id });
  }

  addTracks(playlistId: string, trackIds: string[]): Promise<number> {
    return this.commands.invoke('add_tracks_to_playlist', { playlistId, trackIds });
  }

  removeTracks(playlistId: string, trackIds: string[]): Promise<number> {
    return this.commands.invoke('remove_tracks_from_playlist', { playlistId, trackIds });
  }

  reorderTracks(playlistId: string, trackIds: string[]): Promise<void> {
    return this.commands.invoke('reorder_playlist_tracks', { playlistId, trackIds });
  }

  async pickCover(): Promise<PlaylistCoverSelection | null> {
    const sourcePath = await this.commands.invoke('open_image_dialog');
    if (!sourcePath) return null;
    const cover_art_path = await this.commands.invoke('cache_playlist_cover', { sourcePath });
    return { cover_art_path };
  }
}

export class TauriPlaylistApi extends IpcPlaylistApi {}

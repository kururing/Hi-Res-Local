import type { CloudApiClient } from '../../api/client';
import type { BackendPlaylist, PlaylistDetails } from '../../types/ipc';
import type {
  CreatePlaylistInput,
  PlaylistApi,
  PlaylistCoverSelection,
  UpdatePlaylistInput,
} from '../contracts';
import { PlatformUnsupportedError } from '../contracts';
import {
  isLocalFilePath,
  redactLocalOptionalPath,
  sanitizeCloudTrack,
} from './WebLibraryApi';

function sanitizePlaylist(playlist: BackendPlaylist): BackendPlaylist {
  return {
    ...playlist,
    cover_art_path: redactLocalOptionalPath(playlist.cover_art_path),
  };
}

function playlistPath(id: string): string {
  return `/v1/playlists/${encodeURIComponent(id)}`;
}

interface CloudPlaylistUpdateBody {
  name?: string | null;
  description?: string | null;
  rules_json?: string | null;
  cover_art_path?: string | null;
}

function cloudUpdateBody(input: UpdatePlaylistInput): CloudPlaylistUpdateBody {
  const body: CloudPlaylistUpdateBody = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.rules_json !== undefined) body.rules_json = input.rules_json;
  if (input.cover_art_path !== undefined) {
    if (typeof input.cover_art_path === 'string' && isLocalFilePath(input.cover_art_path)) {
      return body;
    }
    body.cover_art_path = input.cover_art_path;
  }
  return body;
}

/**
 * Browser cloud runtime. Playlist CRUD goes through CloudApiClient.
 * Local cover picking and filesystem cover paths are rejected so desktop
 * paths are never written to the cloud API.
 */
export class WebPlaylistApi implements PlaylistApi {
  constructor(private readonly cloud: CloudApiClient) {}

  async list(): Promise<BackendPlaylist[]> {
    const payload = await this.cloud.request<BackendPlaylist[]>('/v1/playlists');
    if (!Array.isArray(payload)) {
      throw new Error('Cloud playlists response was not an array.');
    }
    return payload.map(sanitizePlaylist);
  }

  async get(id: string): Promise<PlaylistDetails> {
    const payload = await this.cloud.request<PlaylistDetails>(playlistPath(id));
    if (!payload || typeof payload !== 'object' || !payload.playlist || !Array.isArray(payload.tracks)) {
      throw new Error('Cloud playlist response was invalid.');
    }
    return {
      playlist: sanitizePlaylist(payload.playlist),
      tracks: payload.tracks.map(sanitizeCloudTrack),
    };
  }

  async create(input: CreatePlaylistInput): Promise<BackendPlaylist> {
    const payload = await this.cloud.request<BackendPlaylist>('/v1/playlists', {
      method: 'POST',
      body: {
        name: input.name,
        description: input.description ?? null,
        is_smart: input.is_smart ?? null,
        rules_json: input.rules_json ?? null,
      },
    });
    return sanitizePlaylist(payload);
  }

  async update(input: UpdatePlaylistInput): Promise<BackendPlaylist> {
    const payload = await this.cloud.request<BackendPlaylist>(playlistPath(input.id), {
      method: 'PATCH',
      body: cloudUpdateBody(input),
    });
    return sanitizePlaylist(payload);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.cloud.request<boolean | undefined>(playlistPath(id), {
      method: 'DELETE',
    });
    return result !== false;
  }

  addTracks(playlistId: string, trackIds: string[]): Promise<number> {
    return this.cloud.request<number>(`${playlistPath(playlistId)}/tracks`, {
      method: 'POST',
      body: { track_ids: trackIds },
    });
  }

  removeTracks(playlistId: string, trackIds: string[]): Promise<number> {
    return this.cloud.request<number>(`${playlistPath(playlistId)}/tracks`, {
      method: 'DELETE',
      body: { track_ids: trackIds },
    });
  }

  reorderTracks(playlistId: string, trackIds: string[]): Promise<void> {
    return this.cloud.request<void>(`${playlistPath(playlistId)}/order`, {
      method: 'PUT',
      body: { track_ids: trackIds },
    });
  }

  pickCover(): Promise<PlaylistCoverSelection | null> {
    return Promise.reject(new PlatformUnsupportedError('web', 'pickCover'));
  }
}

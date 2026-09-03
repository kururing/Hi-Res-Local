import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { CatalogRepository } from '../catalog/repository.js';
import type { FrontendTrack } from '../catalog/mapper.js';
import { withTransaction } from '../db/types.js';
import { type TransactionRunner } from '../library/service.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import { isUniqueViolation } from '../db/pgErrors.js';
import { PlaylistRepository, type BackendPlaylist } from './repository.js';
import {
  validateCoverArtPath,
  validatePlaylistDescription,
  validatePlaylistName,
  validateRulesJson,
} from './validation.js';

export interface CreatePlaylistInput {
  name: string;
  description?: string | null;
  is_smart?: boolean | null;
  rules_json?: string | Record<string, unknown> | unknown[] | null;
}

export interface PatchPlaylistInput {
  name?: string | null;
  description?: string | null;
  is_smart?: boolean | null;
  rules_json?: string | Record<string, unknown> | unknown[] | null;
  cover_art_path?: string | null;
}

export interface PlaylistDetails {
  playlist: BackendPlaylist;
  tracks: FrontendTrack[];
}

export class PlaylistService {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: CatalogRepository,
    private readonly runTx: TransactionRunner = withTransaction,
  ) {}

  list(userId: string): Promise<BackendPlaylist[]> {
    return new PlaylistRepository(this.pool).list(userId);
  }

  async get(userId: string, playlistId: string): Promise<PlaylistDetails> {
    const repo = new PlaylistRepository(this.pool);
    const playlist = await repo.getOwned(userId, playlistId);
    const membership = await repo.listMembership(playlistId);
    const dateAdded = new Map(membership.map((row) => [row.track_id, row.added_at]));
    const tracks = await this.catalog.getTracksByIds(
      membership.map((row) => row.track_id),
      dateAdded,
      userId,
    );
    return { playlist, tracks };
  }

  async create(userId: string, input: CreatePlaylistInput): Promise<BackendPlaylist> {
    return this.runTx(this.pool, async (trx) => {
      const repo = new PlaylistRepository(trx);
      return repo.insert({
        id: randomUUID(),
        userId,
        name: validatePlaylistName(input.name),
        description: validatePlaylistDescription(input.description),
        isSmart: Boolean(input.is_smart),
        rulesJson: validateRulesJson(input.rules_json),
      });
    });
  }

  async update(userId: string, playlistId: string, input: PatchPlaylistInput): Promise<BackendPlaylist> {
    return this.runTx(this.pool, async (trx) => {
      const repo = new PlaylistRepository(trx);
      await repo.lockOwned(userId, playlistId);
      const patch: {
        name?: string;
        description?: string | null;
        isSmart?: boolean;
        rulesJson?: string | null;
        coverArtPath?: string | null;
      } = {};
      if (input.name !== undefined && input.name !== null) {
        patch.name = validatePlaylistName(input.name);
      }
      if (input.description !== undefined) {
        patch.description = validatePlaylistDescription(input.description);
      }
      if (input.is_smart !== undefined && input.is_smart !== null) {
        patch.isSmart = input.is_smart;
      }
      if (input.rules_json !== undefined) {
        patch.rulesJson = validateRulesJson(input.rules_json);
      }
      if (input.cover_art_path !== undefined) {
        patch.coverArtPath = validateCoverArtPath(input.cover_art_path);
      }
      return repo.update(userId, playlistId, patch);
    });
  }

  async delete(userId: string, playlistId: string): Promise<boolean> {
    return this.runTx(this.pool, async (trx) => new PlaylistRepository(trx).delete(userId, playlistId));
  }

  async addTracks(userId: string, playlistId: string, trackIds: string[]): Promise<number> {
    const uniqueIds = uniqueTrackIds(trackIds);
    if (uniqueIds.length === 0) return 0;

    return this.runTx(this.pool, async (trx) => {
      const repo = new PlaylistRepository(trx);
      await repo.lockOwned(userId, playlistId);
      const existing = await repo.existingTrackIds(uniqueIds);
      const missing = uniqueIds.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        throw new AppError(404, ErrorCodes.PLAYLIST_TRACK_NOT_FOUND, 'One or more tracks were not found.');
      }

      let position = await repo.maxPosition(playlistId);
      let added = 0;
      for (const trackId of uniqueIds) {
        const inserted = await repo.insertTrack(playlistId, trackId, position + 1);
        if (inserted) {
          position += 1;
          added += 1;
        }
      }
      if (added > 0) await repo.touch(playlistId);
      return added;
    });
  }

  async removeTracks(userId: string, playlistId: string, trackIds: string[]): Promise<number> {
    const uniqueIds = uniqueTrackIds(trackIds);
    if (uniqueIds.length === 0) return 0;

    return this.runTx(this.pool, async (trx) => {
      const repo = new PlaylistRepository(trx);
      await repo.lockOwned(userId, playlistId);
      const removed = await repo.deleteTracks(playlistId, uniqueIds);
      if (removed > 0) {
        await compactPositions(repo, playlistId);
        await repo.touch(playlistId);
      }
      return removed;
    });
  }

  async reorderTracks(userId: string, playlistId: string, trackIds: string[]): Promise<void> {
    if (new Set(trackIds).size !== trackIds.length) {
      throw new AppError(400, ErrorCodes.PLAYLIST_REORDER_MISMATCH, 'Reorder list cannot contain duplicate tracks.');
    }

    try {
      await this.runTx(this.pool, async (trx) => {
        const repo = new PlaylistRepository(trx);
        await repo.lockOwned(userId, playlistId);
        const membership = await repo.listMembership(playlistId);
        const current = membership.map((row) => row.track_id);
        if (!sameMembership(current, trackIds)) {
          throw new AppError(
            400,
            ErrorCodes.PLAYLIST_REORDER_MISMATCH,
            'Reorder list must match the current playlist membership exactly.',
          );
        }
        await applyReorder(repo, playlistId, trackIds);
        await repo.touch(playlistId);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, ErrorCodes.PLAYLIST_CONFLICT, 'Playlist order could not be updated.');
      }
      throw error;
    }
  }
}

function uniqueTrackIds(trackIds: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of trackIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

function sameMembership(current: string[], next: string[]): boolean {
  if (current.length !== next.length) return false;
  const currentSet = new Set(current);
  if (currentSet.size !== next.length) return false;
  return next.every((id) => currentSet.has(id));
}

async function applyReorder(
  repo: PlaylistRepository,
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  if (trackIds.length === 0) return;
  const max = await repo.maxPosition(playlistId);
  const shift = Math.max(max + 1, 0) + trackIds.length;
  for (const [index, trackId] of trackIds.entries()) {
    await repo.setPosition(playlistId, trackId, shift + index);
  }
  for (const [index, trackId] of trackIds.entries()) {
    await repo.setPosition(playlistId, trackId, index);
  }
}

async function compactPositions(repo: PlaylistRepository, playlistId: string): Promise<void> {
  const remaining = await repo.listMembership(playlistId);
  await applyReorder(repo, playlistId, remaining.map((row) => row.track_id));
}

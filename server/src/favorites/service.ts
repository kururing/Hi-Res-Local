import type { Pool } from 'pg';
import { CatalogRepository } from '../catalog/repository.js';
import { withTransaction } from '../db/types.js';
import { AppError, ErrorCodes } from '../errors/appError.js';
import type { TransactionRunner } from '../library/service.js';
import { FavoritesRepository } from './repository.js';

export class FavoritesService {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: CatalogRepository,
    private readonly runTx: TransactionRunner = withTransaction,
  ) {}

  async setTrackFavorite(userId: string, trackId: string, favorite: boolean): Promise<void> {
    await this.runTx(this.pool, async (trx) => {
      const catalog = new CatalogRepository(trx);
      const exists = await catalog.trackExists(trackId);
      if (!exists) {
        throw new AppError(404, ErrorCodes.CATALOG_NOT_FOUND, 'Track not found.');
      }
      const repo = new FavoritesRepository(trx);
      if (favorite) {
        await repo.addTrack(userId, trackId);
      } else {
        await repo.removeTrack(userId, trackId);
      }
    });
  }

  async setAlbumFavorite(
    userId: string,
    albumTitle: string,
    artistName: string,
    favorite: boolean,
  ): Promise<void> {
    await this.runTx(this.pool, async (trx) => {
      const catalog = new CatalogRepository(trx);
      const album = await catalog.resolveAlbumByTitleAndArtist(albumTitle, artistName);
      const repo = new FavoritesRepository(trx);
      if (favorite) {
        await repo.addAlbum(userId, album.id);
      } else {
        await repo.removeAlbum(userId, album.id);
      }
    });
  }

  async setArtistFavorite(userId: string, artistName: string, favorite: boolean): Promise<void> {
    await this.runTx(this.pool, async (trx) => {
      const catalog = new CatalogRepository(trx);
      const artist = await catalog.resolveArtistByName(artistName);
      const repo = new FavoritesRepository(trx);
      if (favorite) {
        await repo.addArtist(userId, artist.id);
      } else {
        await repo.removeArtist(userId, artist.id);
      }
    });
  }

  listAlbums(userId: string): Promise<Array<{ album_title: string; artist_name: string }>> {
    return new FavoritesRepository(this.pool).listAlbums(userId);
  }

  listArtists(userId: string): Promise<string[]> {
    return new FavoritesRepository(this.pool).listArtists(userId);
  }
}

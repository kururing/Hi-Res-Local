import type { CatalogSearchQuery, SearchPage } from './repository.js';
import { CatalogRepository } from './repository.js';
import type { FrontendAlbum, FrontendArtist, FrontendLibraryStats, FrontendTrack } from './mapper.js';

export class CatalogService {
  constructor(private readonly repo: CatalogRepository) {}

  search(input: CatalogSearchQuery, userId?: string): Promise<SearchPage> {
    return this.repo.search(input, userId);
  }

  listTracks(
    userId?: string,
    page?: { limit?: number; cursor?: string },
  ): Promise<FrontendTrack[] | { items: FrontendTrack[]; next_cursor: string | null; has_more: boolean }> {
    return this.repo.listPublishedTracks(userId, page);
  }

  listArtists(page?: { limit?: number; cursor?: string }) {
    return this.repo.listPublishedArtists(page);
  }

  listAlbums(page?: { limit?: number; cursor?: string }) {
    return this.repo.listPublishedAlbums(page);
  }

  stats(): Promise<FrontendLibraryStats> {
    return this.repo.publishedStats();
  }

  getTrack(trackId: string, userId?: string): Promise<FrontendTrack> {
    return this.repo.getTrack(trackId, userId);
  }

  getAlbum(albumId: string, userId?: string): Promise<FrontendAlbum> {
    return this.repo.getAlbum(albumId, true, userId);
  }

  getArtist(artistId: string): Promise<FrontendArtist> {
    return this.repo.getArtist(artistId);
  }

  listAlbumTracks(albumId: string, userId?: string): Promise<FrontendTrack[]> {
    return this.repo.listAlbumTracks(albumId, userId);
  }

  listArtistAlbums(artistId: string): Promise<FrontendAlbum[]> {
    return this.repo.listArtistAlbums(artistId);
  }
}

import { PlatformUnsupportedError, type AppRuntime } from '../contracts';
import type { AdminCatalogApi } from './contracts';
import type { AdminCapabilities } from './types';

export class UnsupportedAdminCatalogApi implements AdminCatalogApi {
  constructor(private readonly runtime: AppRuntime) {}

  async getCapabilities(): Promise<AdminCapabilities> {
    return { catalog_admin: false };
  }

  async listArtists(): Promise<never> { return this.fail(); }
  async createArtist(): Promise<never> { return this.fail(); }
  async updateArtist(): Promise<never> { return this.fail(); }
  async listAlbums(): Promise<never> { return this.fail(); }
  async createAlbum(): Promise<never> { return this.fail(); }
  async updateAlbum(): Promise<never> { return this.fail(); }
  async listTracks(): Promise<never> { return this.fail(); }
  async createTrack(): Promise<never> { return this.fail(); }
  async getTrack(): Promise<never> { return this.fail(); }
  async updateTrack(): Promise<never> { return this.fail(); }
  async deleteTrack(): Promise<never> { return this.fail(); }
  async publishTrack(): Promise<never> { return this.fail(); }
  async unpublishTrack(): Promise<never> { return this.fail(); }
  async initAudioUpload(): Promise<never> { return this.fail(); }
  async initArtworkUpload(): Promise<never> { return this.fail(); }
  async getUpload(): Promise<never> { return this.fail(); }
  async completeUpload(): Promise<never> { return this.fail(); }
  async cancelUpload(): Promise<never> { return this.fail(); }
  async retryJob(): Promise<never> { return this.fail(); }
  async createImport(): Promise<never> { return this.fail(); }
  async listImports(): Promise<never> { return this.fail(); }
  async getImport(): Promise<never> { return this.fail(); }
  async updateImport(): Promise<never> { return this.fail(); }
  async completeImport(): Promise<never> { return this.fail(); }
  async cancelImport(): Promise<never> { return this.fail(); }
  async retryImport(): Promise<never> { return this.fail(); }
  async commitImport(): Promise<never> { return this.fail(); }
  async commitImports(): Promise<never> { return this.fail(); }
  async reconcileImports(): Promise<never> { return this.fail(); }
  async lookupArtistArtwork(): Promise<never> { return this.fail(); }
  async lookupAlbumArtwork(): Promise<never> { return this.fail(); }
  async lookupMissingArtwork(): Promise<never> { return this.fail(); }

  private fail(): never {
    throw new PlatformUnsupportedError(this.runtime, 'admin catalog');
  }
}

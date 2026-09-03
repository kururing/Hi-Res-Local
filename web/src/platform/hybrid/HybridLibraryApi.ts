import type { LibraryStats, ScanProgress, Track } from '../../types/library';
import type { LibraryRoot } from '../../types/ipc';
import type { LibraryApi, LibraryScanFinished } from '../contracts';
import {
  mergeLocalAndCloudTracks,
  statsFromTracks,
  tagLocalTracks,
} from './mergeLibrary';

/**
 * Desktop hybrid library: local SQLite/filesystem plus the published cloud
 * catalog when the user is signed in. Scan/root mutations stay local-only.
 */
export class HybridLibraryApi implements LibraryApi {
  constructor(
    private readonly local: LibraryApi,
    private readonly cloud: LibraryApi,
    private readonly isAuthenticated: () => boolean,
  ) {}

  async getAllTracks(): Promise<Track[]> {
    const localTracks = await this.local.getAllTracks();
    if (!this.isAuthenticated()) return tagLocalTracks(localTracks);

    try {
      const cloudTracks = await this.cloud.getAllTracks();
      return mergeLocalAndCloudTracks(localTracks, cloudTracks);
    } catch (error) {
      console.warn('Cloud catalog unavailable; using the local library.', error);
      return tagLocalTracks(localTracks);
    }
  }

  async getStats(): Promise<LibraryStats> {
    const [localStats, tracks] = await Promise.all([
      this.local.getStats(),
      this.getAllTracks(),
    ]);
    if (!this.isAuthenticated()) return localStats;
    return statsFromTracks(tracks, localStats);
  }

  getRoots(): Promise<LibraryRoot[]> {
    return this.local.getRoots();
  }

  pickFolder(): Promise<string | null> {
    return this.local.pickFolder();
  }

  addRoot(path: string, name: string): Promise<LibraryRoot> {
    return this.local.addRoot(path, name);
  }

  removeRoot(path: string): Promise<boolean> {
    return this.local.removeRoot(path);
  }

  scanDirectory(path: string): Promise<Track[]> {
    return this.local.scanDirectory(path);
  }

  scanLibrary(): Promise<number> {
    return this.local.scanLibrary();
  }

  setDirectoryWatching(enabled: boolean): Promise<void> {
    return this.local.setDirectoryWatching(enabled);
  }

  subscribeScanProgress(callback: (progress: ScanProgress) => void): Promise<() => void> {
    return this.local.subscribeScanProgress(callback);
  }

  subscribeScanFinished(callback: (result: LibraryScanFinished) => void): Promise<() => void> {
    return this.local.subscribeScanFinished(callback);
  }

  subscribeTrackUpdated(callback: (track: Track) => void): Promise<() => void> {
    return this.local.subscribeTrackUpdated(callback);
  }

  subscribeTrackDeleted(callback: (trackId: string) => void): Promise<() => void> {
    return this.local.subscribeTrackDeleted(callback);
  }
}

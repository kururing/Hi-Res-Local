import type { LibraryStats, ScanProgress, Track } from '../../types/library';
import type { LibraryRoot } from '../../types/ipc';
import type { LibraryApi, LibraryScanFinished } from '../contracts';
import type { MockDataStore } from './MockDataStore';
import type { MockEventBus } from './MockEventBus';

const DEFAULT_SCAN_STEP_DELAY_MS = 60;
const SCAN_FILES_PER_ROOT = 12;

/**
 * Direct in-memory library adapter. Uses the shared MockDataStore and
 * MockEventBus; it does not talk to the typed IPC adapter.
 */
export class MockLibraryApi implements LibraryApi {
  constructor(
    private readonly store: MockDataStore,
    private readonly events: MockEventBus,
    private readonly scanStepDelayMs = DEFAULT_SCAN_STEP_DELAY_MS,
  ) {}

  getAllTracks(): Promise<Track[]> {
    return Promise.resolve(this.store.getTracks());
  }

  getStats(): Promise<LibraryStats> {
    return Promise.resolve(this.store.getStats());
  }

  getRoots(): Promise<LibraryRoot[]> {
    return Promise.resolve(this.store.getRoots());
  }

  pickFolder(): Promise<string | null> {
    return Promise.resolve('D:/Music/Hi-Res Collection');
  }

  addRoot(path: string, name: string): Promise<LibraryRoot> {
    return Promise.resolve(this.store.addRoot(path, name));
  }

  removeRoot(path: string): Promise<boolean> {
    return Promise.resolve(this.store.removeRoot(path));
  }

  async scanDirectory(path: string): Promise<Track[]> {
    const total = SCAN_FILES_PER_ROOT;
    await this.emitScanProgress(path, total);
    return this.store.getTracks();
  }

  async scanLibrary(): Promise<number> {
    const total = this.store.getRoots().length * SCAN_FILES_PER_ROOT;
    await this.emitScanProgress('library', total);
    return total;
  }

  setDirectoryWatching(_enabled: boolean): Promise<void> {
    return Promise.resolve();
  }

  async subscribeScanProgress(callback: (progress: ScanProgress) => void): Promise<() => void> {
    return this.events.subscribe('library://scan_progress', callback);
  }

  async subscribeScanFinished(callback: (result: LibraryScanFinished) => void): Promise<() => void> {
    return this.events.subscribe('library://scan_finished', callback);
  }

  async subscribeTrackUpdated(callback: (track: Track) => void): Promise<() => void> {
    return this.events.subscribe('library:track_updated', callback);
  }

  async subscribeTrackDeleted(callback: (trackId: string) => void): Promise<() => void> {
    return this.events.subscribe('library:track_deleted', callback);
  }

  private async emitScanProgress(basePath: string, total: number): Promise<void> {
    for (let i = 1; i <= total; i++) {
      await this.delay();
      const progress: ScanProgress = {
        total_files: total,
        scanned_files: i,
        current_path: `${basePath}/track_${i}.flac`,
        is_scanning: i < total,
      };
      this.events.emit('library://scan_progress', progress);
    }
    this.events.emit('library://scan_finished', { total, success: true });
  }

  private delay(): Promise<void> {
    if (this.scanStepDelayMs <= 0) return Promise.resolve();
    return new Promise(resolve => {
      setTimeout(resolve, this.scanStepDelayMs);
    });
  }
}

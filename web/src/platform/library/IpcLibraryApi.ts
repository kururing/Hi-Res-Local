import type { LibraryStats, ScanProgress, Track } from '../../types/library';
import type { LibraryRoot } from '../../types/ipc';
import type {
  LibraryApi,
  LibraryScanFinished,
  PlatformCommandGateway,
} from '../contracts';

/** IPC-backed library adapter for the Tauri desktop runtime. */
export class IpcLibraryApi implements LibraryApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  getAllTracks(): Promise<Track[]> {
    return this.commands.invoke('get_all_tracks');
  }

  getStats(): Promise<LibraryStats> {
    return this.commands.invoke('get_library_stats');
  }

  getRoots(): Promise<LibraryRoot[]> {
    return this.commands.invoke('get_library_roots');
  }

  pickFolder(): Promise<string | null> {
    return this.commands.invoke('open_folder_dialog');
  }

  addRoot(path: string, name: string): Promise<LibraryRoot> {
    return this.commands.invoke('add_library_root', { path, name });
  }

  removeRoot(path: string): Promise<boolean> {
    return this.commands.invoke('remove_library_root_by_path', { path });
  }

  scanDirectory(path: string): Promise<Track[]> {
    return this.commands.invoke('scan_directory', { path });
  }

  scanLibrary(): Promise<number> {
    return this.commands.invoke('scan_library');
  }

  setDirectoryWatching(enabled: boolean): Promise<void> {
    return this.commands.invoke('set_directory_watching', { enabled });
  }

  subscribeScanProgress(callback: (progress: ScanProgress) => void): Promise<() => void> {
    return this.commands.listen('library://scan_progress', callback);
  }

  subscribeScanFinished(callback: (result: LibraryScanFinished) => void): Promise<() => void> {
    return this.commands.listen('library://scan_finished', callback);
  }

  subscribeTrackUpdated(callback: (track: Track) => void): Promise<() => void> {
    return this.commands.listen('library:track_updated', callback);
  }

  subscribeTrackDeleted(callback: (trackId: string) => void): Promise<() => void> {
    return this.commands.listen('library:track_deleted', callback);
  }
}

export class TauriLibraryApi extends IpcLibraryApi {}

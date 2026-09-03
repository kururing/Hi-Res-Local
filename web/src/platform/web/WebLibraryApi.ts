import type { CloudApiClient } from '../../api/client';
import type { LibraryStats, ScanProgress, Track } from '../../types/library';
import type { LibraryRoot } from '../../types/ipc';
import type { LibraryApi, LibraryScanFinished } from '../contracts';
import { PlatformUnsupportedError } from '../contracts';

const LOCAL_UNIX_PREFIXES = [
  '/Users/',
  '/home/',
  '/Volumes/',
  '/mnt/',
  '/media/',
  '/opt/',
  '/var/',
  '/tmp/',
  '/private/',
] as const;

export function isLocalFilePath(value: string): boolean {
  const path = value.trim();
  if (!path) return false;
  if (path.startsWith('file:')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  if (path.startsWith('\\\\')) return true;
  return LOCAL_UNIX_PREFIXES.some(prefix => path.startsWith(prefix));
}

function redactLocalPath(value: string): string {
  return isLocalFilePath(value) ? '' : value;
}

export function redactLocalOptionalPath(value: string | null | undefined): string | null {
  if (value == null || value === '') return value ?? null;
  return isLocalFilePath(value) ? null : value;
}

export function sanitizeCloudTrack(track: Track): Track {
  return {
    ...track,
    path: redactLocalPath(track.path),
    cover_art_path: redactLocalOptionalPath(track.cover_art_path),
    ...(track.artist_image_url !== undefined
      ? { artist_image_url: redactLocalOptionalPath(track.artist_image_url) }
      : {}),
  };
}

function sanitizeCloudRoot(root: LibraryRoot): LibraryRoot {
  return {
    ...root,
    path: redactLocalPath(root.path),
  };
}

/**
 * Browser cloud runtime. The home library is the published shared catalog;
 * per-user `/v1/library/*` saves are a separate collection. Local folder
 * picking, scanning, and library-root mutation are unsupported so desktop
 * filesystem paths are never written to the cloud API.
 */
export class WebLibraryApi implements LibraryApi {
  constructor(private readonly cloud: CloudApiClient) {}

  async getAllTracks(): Promise<Track[]> {
    const payload = await this.cloud.request<Track[]>('/v1/catalog/tracks');
    if (!Array.isArray(payload)) {
      throw new Error('Cloud catalog tracks response was not an array.');
    }
    return payload.map(sanitizeCloudTrack);
  }

  getStats(): Promise<LibraryStats> {
    return this.cloud.request<LibraryStats>('/v1/catalog/stats');
  }

  async getRoots(): Promise<LibraryRoot[]> {
    const payload = await this.cloud.request<LibraryRoot[]>('/v1/library/roots');
    if (!Array.isArray(payload)) {
      throw new Error('Cloud library roots response was not an array.');
    }
    return payload.map(sanitizeCloudRoot);
  }

  pickFolder(): Promise<string | null> {
    return Promise.reject(new PlatformUnsupportedError('web', 'pickFolder'));
  }

  addRoot(_path: string, _name: string): Promise<LibraryRoot> {
    return Promise.reject(new PlatformUnsupportedError('web', 'addRoot'));
  }

  removeRoot(_path: string): Promise<boolean> {
    return Promise.reject(new PlatformUnsupportedError('web', 'removeRoot'));
  }

  scanDirectory(_path: string): Promise<Track[]> {
    return Promise.reject(new PlatformUnsupportedError('web', 'scanDirectory'));
  }

  scanLibrary(): Promise<number> {
    return Promise.reject(new PlatformUnsupportedError('web', 'scanLibrary'));
  }

  setDirectoryWatching(_enabled: boolean): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'setDirectoryWatching'));
  }

  async subscribeScanProgress(_callback: (progress: ScanProgress) => void): Promise<() => void> {
    return () => undefined;
  }

  async subscribeScanFinished(_callback: (result: LibraryScanFinished) => void): Promise<() => void> {
    return () => undefined;
  }

  async subscribeTrackUpdated(_callback: (track: Track) => void): Promise<() => void> {
    return () => undefined;
  }

  async subscribeTrackDeleted(_callback: (trackId: string) => void): Promise<() => void> {
    return () => undefined;
  }
}

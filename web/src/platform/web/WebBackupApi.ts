import type { BackupApi } from '../contracts';
import { PlatformUnsupportedError } from '../contracts';

/** Browser runtime has no local SQLite dump; cloud backup is not designed yet. */
export class WebBackupApi implements BackupApi {
  exportDatabase(): Promise<number[]> {
    return Promise.reject(new PlatformUnsupportedError('web', 'exportDatabase'));
  }

  importDatabase(_data: number[]): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'importDatabase'));
  }
}

import type { BackupApi } from '../contracts';

/** Mock preview has no SQLite dump; export is empty and import is a no-op. */
export class MockBackupApi implements BackupApi {
  exportDatabase(): Promise<number[]> {
    return Promise.resolve([]);
  }

  importDatabase(_data: number[]): Promise<void> {
    return Promise.resolve();
  }
}

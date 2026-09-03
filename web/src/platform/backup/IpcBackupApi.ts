import type { BackupApi, PlatformCommandGateway } from '../contracts';

/** IPC-backed SQLite backup adapter for the Tauri desktop runtime. */
export class IpcBackupApi implements BackupApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  exportDatabase(): Promise<number[]> {
    return this.commands.invoke('export_database');
  }

  importDatabase(data: number[]): Promise<void> {
    return this.commands.invoke('import_database', { data });
  }
}

export class TauriBackupApi extends IpcBackupApi {}

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TauriBackupApi } from '../platform/backup/IpcBackupApi';
import { MockBackupApi } from '../platform/mock/MockBackupApi';
import type { PlatformCommandGateway } from '../platform/contracts';
import { PlatformUnsupportedError } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebBackupApi } from '../platform/web/WebBackupApi';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

describe('TauriBackupApi', () => {
  it('exports and imports the database as a byte array', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriBackupApi(commands);
    const bytes = [83, 81, 76, 105, 116, 101];

    invoke.mockResolvedValueOnce(bytes);
    await expect(api.exportDatabase()).resolves.toEqual(bytes);
    expect(invoke).toHaveBeenLastCalledWith('export_database');

    invoke.mockResolvedValueOnce(undefined);
    await api.importDatabase(bytes);
    expect(invoke).toHaveBeenLastCalledWith('import_database', { data: bytes });
  });
});

describe('platform wiring', () => {
  it('exposes the matching backup adapter and capability on each runtime', () => {
    const tauri = createTauriPlatform();
    const mock = createMockPlatform();
    const web = createWebPlatform('/api');

    expect(tauri.backup).toBeInstanceOf(TauriBackupApi);
    expect(mock.backup).toBeInstanceOf(MockBackupApi);
    expect(web.backup).toBeInstanceOf(WebBackupApi);
    expect(tauri.capabilities.databaseBackup).toBe(true);
    expect(mock.capabilities.databaseBackup).toBe(true);
    expect(web.capabilities.databaseBackup).toBe(false);
  });
});

describe('SettingsView backup visibility', () => {
  it('hides database backup after cloud login', () => {
    const source = readFileSync(new URL('../components/views/SettingsView.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/authStatus !== 'authenticated'/);
  });
});

describe('WebBackupApi', () => {
  it('reports database backup as unsupported', async () => {
    const api = new WebBackupApi();

    await expect(api.exportDatabase()).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.importDatabase([1, 2, 3])).rejects.toBeInstanceOf(PlatformUnsupportedError);
  });
});

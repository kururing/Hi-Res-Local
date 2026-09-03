import type { AutostartApi } from '../contracts';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Desktop autostart via the Tauri plugin. Plugin types stay inside this
 * adapter and are not part of the platform contract.
 */
export class TauriAutostartApi implements AutostartApi {
  async isEnabled(): Promise<boolean> {
    try {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart');
      return await isEnabled();
    } catch (error) {
      throw toError(error);
    }
  }

  async enable(): Promise<void> {
    try {
      const { enable } = await import('@tauri-apps/plugin-autostart');
      await enable();
    } catch (error) {
      throw toError(error);
    }
  }

  async disable(): Promise<void> {
    try {
      const { disable } = await import('@tauri-apps/plugin-autostart');
      await disable();
    } catch (error) {
      throw toError(error);
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.enable();
    else await this.disable();
  }
}

import type { AutostartApi } from '../contracts';
import type { MockDataStore } from './MockDataStore';

/** In-memory autostart flag for Vite preview and tests. */
export class MockAutostartApi implements AutostartApi {
  constructor(private readonly store: MockDataStore) {}

  isEnabled(): Promise<boolean> {
    return Promise.resolve(this.store.isAutostartEnabled());
  }

  enable(): Promise<void> {
    this.store.setAutostartEnabled(true);
    return Promise.resolve();
  }

  disable(): Promise<void> {
    this.store.setAutostartEnabled(false);
    return Promise.resolve();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.enable();
    else await this.disable();
  }
}

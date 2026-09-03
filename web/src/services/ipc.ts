import { IpcCommands, IpcEvents } from '../types/ipc';

type EventCallback<T> = (payload: T) => void;

/**
 * Detects whether the app is executing inside a real Tauri desktop shell.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

/**
 * Typed Tauri invoke/listen routing, plus a lazy mock compatibility bridge
 * for leftover IpcService callers. Mock domain state lives in platform/mock —
 * this file must not own fixtures or domain storage.
 */
export const IpcService = {
  /**
   * Invokes a typed Tauri backend command.
   */
  async invoke<K extends keyof IpcCommands>(
    command: K,
    args?: IpcCommands[K]['args']
  ): Promise<IpcCommands[K]['return']> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke(command, args as Record<string, unknown>);
      } catch (err) {
        console.error(`[Tauri IPC] Command "${command}" failed:`, err);
        throw err;
      }
    }

    const { getDefaultMockRuntime } = await import('../platform/mock/MockRuntime');
    return getDefaultMockRuntime().commands.invoke(command, args);
  },

  /**
   * Subscribes to typed Tauri backend events.
   */
  async listen<K extends keyof IpcEvents>(
    event: K,
    callback: EventCallback<IpcEvents[K]>
  ): Promise<() => void> {
    if (isTauri()) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen(event, (evt: { payload: IpcEvents[K] }) => callback(evt.payload));
        return unlisten;
      } catch (err) {
        console.error(`[Tauri IPC] Event "${event}" subscription failed:`, err);
        throw err;
      }
    }

    const { getDefaultMockRuntime } = await import('../platform/mock/MockRuntime');
    return getDefaultMockRuntime().commands.listen(event, callback);
  },
};

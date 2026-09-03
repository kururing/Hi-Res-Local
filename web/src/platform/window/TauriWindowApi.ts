import type { PlatformCloseRequest, PlatformCommandGateway, WindowApi } from '../contracts';
import { subscribeBrowserResize } from './browserResize';

interface TauriCloseRequestedEvent {
  preventDefault: () => void;
}

interface TauriAppWindow {
  onCloseRequested: (
    handler: (event: TauriCloseRequestedEvent) => void | Promise<void>
  ) => Promise<() => void>;
  onResized: (handler: () => void) => Promise<() => void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  hide: () => Promise<void>;
}

async function getTauriWindow(): Promise<TauriAppWindow> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

function safeCall(label: string, cleanup: (() => void) | undefined): void {
  try {
    cleanup?.();
  } catch (error) {
    console.warn(label, error);
  }
}

/**
 * Desktop window chrome. Async native listeners can be cancelled before they
 * resolve so unmounting mid-setup does not leak, and cleanup is idempotent.
 */
export class TauriWindowApi implements WindowApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  onCloseRequested(
    callback: (event: PlatformCloseRequest) => void | Promise<void>
  ): Promise<() => void> {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let cleaned = false;

    const setup = getTauriWindow()
      .then(appWindow =>
        appWindow.onCloseRequested(event => {
          const request: PlatformCloseRequest = {
            preventDefault: () => {
              event.preventDefault();
            },
          };
          return callback(request);
        })
      )
      .then(dispose => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      });

    void setup.catch(error => {
      if (!disposed) {
        console.error('Failed to subscribe to window close requests', error);
      }
    });

    const unsubscribe = () => {
      if (cleaned) return;
      cleaned = true;
      disposed = true;
      safeCall('Failed to unsubscribe from window close requests', unlisten);
    };

    return Promise.resolve(unsubscribe);
  }

  subscribeResize(callback: () => void): Promise<() => void> {
    let disposed = false;
    let unlistenNative: (() => void) | undefined;
    let cleaned = false;
    const unlistenBrowser = subscribeBrowserResize(callback);

    const setup = getTauriWindow()
      .then(appWindow => appWindow.onResized(() => {
        callback();
      }))
      .then(dispose => {
        if (disposed) {
          dispose();
          return;
        }
        unlistenNative = dispose;
      });

    void setup.catch(error => {
      if (!disposed) {
        console.warn('Failed to subscribe to native resize events', error);
      }
    });

    const unsubscribe = () => {
      if (cleaned) return;
      cleaned = true;
      disposed = true;
      safeCall('Failed to remove browser resize listener', unlistenBrowser);
      safeCall('Failed to unsubscribe from native resize events', unlistenNative);
    };

    return Promise.resolve(unsubscribe);
  }

  async minimize(): Promise<void> {
    const appWindow = await getTauriWindow();
    await appWindow.minimize();
  }

  async toggleMaximize(): Promise<void> {
    const appWindow = await getTauriWindow();
    await appWindow.toggleMaximize();
  }

  async hide(): Promise<void> {
    const appWindow = await getTauriWindow();
    await appWindow.hide();
  }

  quit(): Promise<void> {
    return this.commands.invoke('quit_app');
  }
}

import type { PlatformCloseRequest, WindowApi } from '../contracts';
import { subscribeBrowserResize } from './browserResize';

/** Vite mock preview has no native window chrome. Resize uses the browser. */
export class MockWindowApi implements WindowApi {
  async onCloseRequested(
    _callback: (event: PlatformCloseRequest) => void | Promise<void>
  ): Promise<() => void> {
    return () => undefined;
  }

  async subscribeResize(callback: () => void): Promise<() => void> {
    return subscribeBrowserResize(callback);
  }

  async minimize(): Promise<void> {
    return undefined;
  }

  async toggleMaximize(): Promise<void> {
    return undefined;
  }

  async hide(): Promise<void> {
    return undefined;
  }

  async quit(): Promise<void> {
    return undefined;
  }
}

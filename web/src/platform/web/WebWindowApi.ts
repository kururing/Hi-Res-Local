import type { PlatformCloseRequest, WindowApi } from '../contracts';
import { subscribeBrowserResize } from '../window/browserResize';

/** Browser runtime has no native window chrome to hide, minimize, or quit. */
export class WebWindowApi implements WindowApi {
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

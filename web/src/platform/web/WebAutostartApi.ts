import type { AutostartApi } from '../contracts';
import { PlatformUnsupportedError } from '../contracts';

/**
 * Browser runtime cannot register OS login items. Reads report disabled;
 * mutations throw rather than pretending to succeed.
 */
export class WebAutostartApi implements AutostartApi {
  isEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  }

  enable(): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'autostart.enable'));
  }

  disable(): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'autostart.disable'));
  }

  setEnabled(_enabled: boolean): Promise<void> {
    return Promise.reject(new PlatformUnsupportedError('web', 'autostart.setEnabled'));
  }
}

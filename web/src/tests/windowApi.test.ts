import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformCommandGateway } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebWindowApi } from '../platform/web/WebWindowApi';
import { MockWindowApi } from '../platform/window/MockWindowApi';
import { TauriWindowApi } from '../platform/window/TauriWindowApi';

const {
  mockOnCloseRequested,
  mockHide,
  mockMinimize,
  mockToggleMaximize,
  mockOnResized,
} = vi.hoisted(() => ({
  mockOnCloseRequested: vi.fn(),
  mockHide: vi.fn(),
  mockMinimize: vi.fn(),
  mockToggleMaximize: vi.fn(),
  mockOnResized: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: mockOnCloseRequested,
    onResized: mockOnResized,
    hide: mockHide,
    minimize: mockMinimize,
    toggleMaximize: mockToggleMaximize,
  }),
}));

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function installBrowserWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const fakeWindow = {
    addEventListener: (type: string, handler: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, handler: () => void) => {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent: (type: string) => {
      listeners.get(type)?.forEach(handler => handler());
      return true;
    },
  };
  vi.stubGlobal('window', fakeWindow);
  return { fakeWindow, listeners };
}

describe('platform wiring', () => {
  it('exposes the matching window adapter on each runtime', () => {
    expect(createTauriPlatform().window).toBeInstanceOf(TauriWindowApi);
    expect(createMockPlatform().window).toBeInstanceOf(MockWindowApi);
    expect(createWebPlatform('/api').window).toBeInstanceOf(WebWindowApi);
    expect(createTauriPlatform().capabilities.nativeWindowChrome).toBe(true);
    expect(createMockPlatform().capabilities.nativeWindowChrome).toBe(false);
    expect(createWebPlatform('/api').capabilities.nativeWindowChrome).toBe(false);
  });
});

describe('TauriWindowApi', () => {
  beforeEach(() => {
    mockOnCloseRequested.mockReset();
    mockHide.mockReset();
    mockMinimize.mockReset();
    mockToggleMaximize.mockReset();
    mockOnResized.mockReset();
    mockOnCloseRequested.mockResolvedValue(vi.fn());
    mockOnResized.mockResolvedValue(vi.fn());
    mockHide.mockResolvedValue(undefined);
    mockMinimize.mockResolvedValue(undefined);
    mockToggleMaximize.mockResolvedValue(undefined);
    installBrowserWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unsubscribes the native close listener', async () => {
    const unlisten = vi.fn();
    mockOnCloseRequested.mockResolvedValue(unlisten);
    const api = new TauriWindowApi(createGateway().commands);
    const unsubscribe = await api.onCloseRequested(() => undefined);

    unsubscribe();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it('does not leak when unsubscribed before the native listener resolves', async () => {
    const unlisten = vi.fn();
    let resolveListen: ((dispose: () => void) => void) | undefined;
    mockOnCloseRequested.mockImplementation(
      () => new Promise<() => void>(resolve => {
        resolveListen = resolve;
      })
    );

    const api = new TauriWindowApi(createGateway().commands);
    const unsubscribe = await api.onCloseRequested(() => undefined);
    unsubscribe();

    await vi.waitFor(() => expect(resolveListen).toBeTypeOf('function'));
    resolveListen?.(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it('can be unsubscribed more than once without throwing', async () => {
    const unlisten = vi.fn();
    mockOnCloseRequested.mockResolvedValue(unlisten);
    const api = new TauriWindowApi(createGateway().commands);
    const unsubscribe = await api.onCloseRequested(() => undefined);

    expect(() => {
      unsubscribe();
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it('hides, minimizes, maximizes, and quits through the native adapter', async () => {
    const { invoke, commands } = createGateway();
    invoke.mockResolvedValue(undefined);
    const api = new TauriWindowApi(commands);

    await api.hide();
    await api.minimize();
    await api.toggleMaximize();
    await api.quit();

    expect(mockHide).toHaveBeenCalledTimes(1);
    expect(mockMinimize).toHaveBeenCalledTimes(1);
    expect(mockToggleMaximize).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('quit_app');
  });

  it('forwards preventDefault without exposing Tauri event types to the callback', async () => {
    const preventDefault = vi.fn();
    mockOnCloseRequested.mockImplementation(async handler => {
      await handler({ preventDefault });
      return vi.fn();
    });

    const api = new TauriWindowApi(createGateway().commands);
    await api.onCloseRequested(event => {
      event.preventDefault();
    });
    await vi.waitFor(() => expect(preventDefault).toHaveBeenCalledTimes(1));
  });

  it('unsubscribes native resize even if cleanup runs before the listener resolves', async () => {
    const unlisten = vi.fn();
    let resolveListen: ((dispose: () => void) => void) | undefined;
    mockOnResized.mockImplementation(
      () => new Promise<() => void>(resolve => {
        resolveListen = resolve;
      })
    );

    const api = new TauriWindowApi(createGateway().commands);
    const unsubscribe = await api.subscribeResize(() => undefined);
    unsubscribe();

    await vi.waitFor(() => expect(resolveListen).toBeTypeOf('function'));
    resolveListen?.(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it('cleans up remaining resize listeners when one cleanup throws', async () => {
    const unlisten = vi.fn();
    mockOnResized.mockResolvedValue(unlisten);
    const { fakeWindow } = installBrowserWindow();
    fakeWindow.removeEventListener = () => {
      throw new Error('browser cleanup failed');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const api = new TauriWindowApi(createGateway().commands);
    const unsubscribe = await api.subscribeResize(() => undefined);
    await vi.waitFor(() => expect(mockOnResized).toHaveBeenCalled());
    expect(() => unsubscribe()).not.toThrow();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe.each([
  ['MockWindowApi', MockWindowApi],
  ['WebWindowApi', WebWindowApi],
] as const)('%s', (name, Api) => {
  let browserWindow: ReturnType<typeof installBrowserWindow>;

  beforeEach(() => {
    browserWindow = installBrowserWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a safe no-op for native window chrome', async () => {
    const api = new Api();
    const unsubscribe = await api.onCloseRequested(() => {
      throw new Error('browser close listeners must not run');
    });

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    await expect(api.hide()).resolves.toBeUndefined();
    await expect(api.minimize()).resolves.toBeUndefined();
    await expect(api.toggleMaximize()).resolves.toBeUndefined();
    await expect(api.quit()).resolves.toBeUndefined();
  });

  it('subscribes to browser resize and removes the listener on cleanup', async () => {
    const api = new Api();
    const callback = vi.fn();
    const unsubscribe = await api.subscribeResize(callback);

    browserWindow.fakeWindow.dispatchEvent('resize');
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    browserWindow.fakeWindow.dispatchEvent('resize');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it(`does not import Tauri from ${name}`, () => {
    const file = name === 'MockWindowApi'
      ? '../platform/window/MockWindowApi.ts'
      : '../platform/web/WebWindowApi.ts';
    const contents = source(file);
    expect(contents).not.toMatch(/@tauri-apps/);
    expect(contents).not.toMatch(/IpcService/);
    expect(contents).not.toMatch(/isTauri/);
  });
});

describe('window consumers', () => {
  it('no longer import IpcService, isTauri, or Tauri window APIs', () => {
    const files = [
      '../components/layout/WindowTitleBar.tsx',
      '../components/layout/AppShell.tsx',
    ];
    for (const file of files) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/IpcService/);
      expect(contents, file).not.toMatch(/isTauri/);
      expect(contents, file).not.toMatch(/@tauri-apps/);
      expect(contents, file).not.toMatch(/getCurrentWindow/);
    }
  });

  it('uses platform window capabilities and quit event order', () => {
    const titleBar = source('../components/layout/WindowTitleBar.tsx');
    expect(titleBar).toMatch(/capabilities\.nativeWindowChrome/);
    expect(titleBar).toMatch(/BEFORE_APP_QUIT_EVENT/);
    expect(titleBar).toMatch(/windowApi\.quit/);
    expect(titleBar.indexOf('BEFORE_APP_QUIT_EVENT'))
      .toBeLessThan(titleBar.indexOf('windowApi.quit'));

    const shell = source('../components/layout/AppShell.tsx');
    expect(shell).toMatch(/windowApi\.subscribeResize/);
  });
});

/** @vitest-environment jsdom */
import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '../components/auth/AuthGate';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { AuthSessionController } from '../auth/AuthSessionController';
import { CloudApiError } from '../api/client';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { usePlatform, PlatformProvider, type RuntimeEnvironment } from '../platform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { createFakeAccount, SAMPLE_SESSION } from './support/auth';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

function webEnvironment(
  account = createFakeAccount(),
  libraryGetAll = vi.fn(async () => [])
): RuntimeEnvironment {
  const platform = createWebPlatform('/api');
  return {
    platform: {
      ...platform,
      account,
      library: {
        ...platform.library,
        getAllTracks: libraryGetAll,
      },
    },
    authSession: new AuthSessionController({ account, enabled: true, broadcast: null }),
  };
}

function mockEnvironment(): RuntimeEnvironment {
  return {
    platform: createMockPlatform(),
    authSession: new AuthSessionController({ account: null, enabled: false, broadcast: null }),
  };
}

function Tree({
  environment,
  children,
}: {
  environment: RuntimeEnvironment;
  children: React.ReactNode;
}) {
  return (
    <PlatformProvider environment={environment}>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <AuthGate>{children}</AuthGate>
          </AuthProvider>
        </SettingsProvider>
      </ToastProvider>
    </PlatformProvider>
  );
}

const DomainChild: React.FC<{ onMount?: () => void }> = ({ onMount }) => {
  const { library } = usePlatform();
  useEffect(() => {
    onMount?.();
    void library.getAllTracks();
  }, [library, onMount]);
  return <div>cloud-app</div>;
};

function mount(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function waitFor(assert: () => void, timeout = 1500) {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeout) {
    try {
      assert();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
      });
    }
  }
  throw lastError;
}

describe('AuthGate', () => {
  let mounted: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  it('lets optional desktop account stay in the local app while anonymous', async () => {
    const platform = createTauriPlatform();
    mounted = mount(
      <Tree
        environment={{
          platform,
          authSession: new AuthSessionController({
            account: createFakeAccount({
              refresh: async () => {
                throw new CloudApiError('Refresh token missing.', 401, {
                  code: 'AUTH_REFRESH_INVALID',
                  message: 'Refresh token missing.',
                  request_id: 'r',
                }, 'AUTH_REFRESH_INVALID');
              },
            }),
            enabled: true,
            broadcast: null,
          }),
        }}
      >
        <div>desktop-app</div>
      </Tree>
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('desktop-app');
    });
    expect(mounted?.container.querySelector('h1')?.textContent).not.toBe('Đăng nhập');
  });

  it('bypasses the gate for mock/tauri runtimes', async () => {
    mounted = mount(
      <Tree environment={mockEnvironment()}>
        <div>desktop-app</div>
      </Tree>
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('desktop-app');
    });
    expect(mounted?.container.textContent).not.toContain('Đăng nhập');
  });

  it('shows login for a web anonymous session and does not mount domain APIs', async () => {
    const account = createFakeAccount({
      refresh: async () => {
        throw new CloudApiError('Refresh token missing.', 401, {
          code: 'AUTH_REFRESH_INVALID',
          message: 'Refresh token missing.',
          request_id: 'r',
        }, 'AUTH_REFRESH_INVALID');
      },
    });
    const libraryGetAll = vi.fn(async () => []);
    mounted = mount(
      <Tree environment={webEnvironment(account, libraryGetAll)}>
        <DomainChild />
      </Tree>
    );
    await waitFor(() => {
      expect(mounted?.container.querySelector('h1')?.textContent).toBe('Đăng nhập');
    });
    expect(libraryGetAll).not.toHaveBeenCalled();
    expect(mounted?.container.textContent).not.toContain('cloud-app');
  });

  it('mounts the app only after authentication', async () => {
    const libraryGetAll = vi.fn(async () => []);
    let domainMounted = false;
    mounted = mount(
      <Tree environment={webEnvironment(createFakeAccount(), libraryGetAll)}>
        <DomainChild onMount={() => { domainMounted = true; }} />
      </Tree>
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('cloud-app');
    });
    expect(domainMounted).toBe(true);
    expect(libraryGetAll).toHaveBeenCalled();
  });

  it('does not call cloud library APIs while bootstrapping', async () => {
    let resolveRefresh!: (value: typeof SAMPLE_SESSION) => void;
    const pending = new Promise<typeof SAMPLE_SESSION>(resolve => {
      resolveRefresh = resolve;
    });
    const account = createFakeAccount({
      refresh: () => pending,
    });
    const libraryGetAll = vi.fn(async () => []);
    mounted = mount(
      <Tree environment={webEnvironment(account, libraryGetAll)}>
        <DomainChild />
      </Tree>
    );
    expect(mounted.container.textContent).toContain('Đang khôi phục phiên đăng nhập');
    expect(libraryGetAll).not.toHaveBeenCalled();
    await act(async () => {
      resolveRefresh(SAMPLE_SESSION);
      await pending;
    });
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('cloud-app');
    });
  });

  it('returns to login after logout and unmounts the app', async () => {
    const LogoutChild: React.FC = () => {
      const { logout } = useAuth();
      return (
        <div>
          <span>cloud-app</span>
          <button type="button" onClick={() => void logout()}>Sign out now</button>
        </div>
      );
    };
    mounted = mount(
      <Tree environment={webEnvironment()}>
        <LogoutChild />
      </Tree>
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('cloud-app');
    });
    const button = Array.from(mounted.container.querySelectorAll('button'))
      .find(node => node.textContent === 'Sign out now');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(mounted?.container.querySelector('h1')?.textContent).toBe('Đăng nhập');
    });
    expect(mounted.container.textContent).not.toContain('cloud-app');
  });

  it('shows an offline retry screen', async () => {
    let fail = true;
    const account = createFakeAccount({
      refresh: async () => {
        if (fail) throw new TypeError('Failed to fetch');
        return SAMPLE_SESSION;
      },
    });
    mounted = mount(
      <Tree environment={webEnvironment(account)}>
        <div>cloud-app</div>
      </Tree>
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('Không kết nối được máy chủ');
    });
    fail = false;
    const retry = Array.from(mounted.container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Thử lại'));
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain('cloud-app');
    });
  });
});

/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '../components/layout/UserMenu';
import { AuthProvider } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { AuthSessionController } from '../auth/AuthSessionController';
import { CloudApiError } from '../api/client';
import { PlatformProvider, type RuntimeEnvironment } from '../platform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createFakeAccount, SAMPLE_USER } from './support/auth';
import { t } from '../i18n';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

function webEnvironment(account = createFakeAccount()): RuntimeEnvironment {
  const platform = createWebPlatform('/api');
  return {
    platform: { ...platform, account },
    authSession: new AuthSessionController({ account, enabled: true, broadcast: null }),
  };
}

function mockEnvironment(): RuntimeEnvironment {
  const platform = createMockPlatform();
  return {
    platform,
    authSession: new AuthSessionController({ account: null, enabled: false, broadcast: null }),
  };
}

function Tree({
  env,
  onNavigate,
}: {
  env: RuntimeEnvironment;
  onNavigate: (view: string) => void;
}) {
  return (
    <PlatformProvider environment={env}>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <UserMenu onNavigate={onNavigate} />
          </AuthProvider>
        </SettingsProvider>
      </ToastProvider>
    </PlatformProvider>
  );
}

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

async function openMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${t('aria_user_menu', 'vi')}"]`);
  if (!trigger) throw new Error('Missing user menu trigger');
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return trigger;
}

describe('User menu', () => {
  let mounted: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  it('opens Account, Settings, and Sign out for a signed-in web user', async () => {
    const onNavigate = vi.fn();
    mounted = mount(<Tree env={webEnvironment()} onNavigate={onNavigate} />);
    await waitFor(() => {
      const button = mounted!.container.querySelector<HTMLButtonElement>(
        `button[aria-label="${t('aria_user_menu', 'vi')}"]`,
      );
      expect(button?.textContent).toContain('B');
    });
    const trigger = mounted.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t('aria_user_menu', 'vi')}"]`,
    );
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mounted.container.textContent).toContain(t('nav_account', 'vi'));
    expect(mounted.container.textContent).toContain(t('nav_settings', 'vi'));
    expect(mounted.container.textContent).toContain(t('settings_account_logout', 'vi'));

    const accountItem = Array.from(mounted.container.querySelectorAll('[role="menuitem"]'))
      .find(button => button.textContent?.includes(t('nav_account', 'vi')));
    await act(async () => {
      accountItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('account');
  });

  it('signs out from the avatar menu', async () => {
    const account = createFakeAccount();
    mounted = mount(<Tree env={webEnvironment(account)} onNavigate={vi.fn()} />);
    await waitFor(() => {
      expect(mounted!.container.querySelector('button[aria-expanded]')?.textContent).toContain('B');
    });
    await openMenu(mounted.container);

    const logout = Array.from(mounted.container.querySelectorAll('[role="menuitem"]'))
      .find(button => button.textContent?.includes(t('settings_account_logout', 'vi')));
    await act(async () => {
      logout?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(account.calls).toContain('logout');
    });
  });

  it('offers Sign in on desktop when account is optional and unsigned', async () => {
    const platform = createTauriPlatform();
    const onNavigate = vi.fn();
    mounted = mount(
      <Tree
        env={{
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
        onNavigate={onNavigate}
      />
    );
    await openMenu(mounted.container);
    expect(mounted.container.textContent).toContain(t('nav_sign_in', 'vi'));
    expect(mounted.container.textContent).not.toContain(t('settings_account_logout', 'vi'));
    const signIn = Array.from(mounted.container.querySelectorAll('[role="menuitem"]'))
      .find(button => button.textContent?.includes(t('nav_sign_in', 'vi')));
    await act(async () => {
      signIn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('account');
  });

  it('hides Account and Sign out when the runtime has no account', async () => {
    mounted = mount(<Tree env={mockEnvironment()} onNavigate={vi.fn()} />);
    await openMenu(mounted.container);
    expect(mounted.container.textContent).toContain(t('nav_settings', 'vi'));
    expect(mounted.container.textContent).not.toContain(t('nav_account', 'vi'));
    expect(mounted.container.textContent).not.toContain(t('settings_account_logout', 'vi'));
    expect(mounted.container.textContent).not.toContain(SAMPLE_USER.displayName);
  });

  it('navigates to settings from the menu', async () => {
    const onNavigate = vi.fn();
    mounted = mount(<Tree env={mockEnvironment()} onNavigate={onNavigate} />);
    await openMenu(mounted.container);
    const settingsItem = Array.from(mounted.container.querySelectorAll('[role="menuitem"]'))
      .find(button => button.textContent?.includes(t('nav_settings', 'vi')));
    await act(async () => {
      settingsItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});

/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSettingsSection } from '../components/auth/AccountSettingsSection';
import { AuthProvider } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { AuthSessionController } from '../auth/AuthSessionController';
import { CloudApiError } from '../api/client';
import { PlatformProvider, type RuntimeEnvironment } from '../platform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { createFakeAccount, SAMPLE_USER } from './support/auth';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

function environment(account = createFakeAccount()): RuntimeEnvironment {
  const platform = createWebPlatform('/api');
  return {
    platform: { ...platform, account },
    authSession: new AuthSessionController({ account, enabled: true, broadcast: null }),
  };
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

function Tree({ env }: { env: RuntimeEnvironment }) {
  return (
    <PlatformProvider environment={env}>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <AccountSettingsSection />
          </AuthProvider>
        </SettingsProvider>
      </ToastProvider>
    </PlatformProvider>
  );
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

function namedInput(container: HTMLElement, labelText: string) {
  const label = Array.from(container.querySelectorAll('label'))
    .find(node => node.textContent === labelText);
  const id = label?.getAttribute('for');
  const input = id ? container.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`) : null;
  if (!input) throw new Error(`Missing ${labelText}`);
  return input;
}

describe('Account settings', () => {
  let mounted: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  it('loads the current user and updates the display name', async () => {
    mounted = mount(<Tree env={environment()} />);
    await waitFor(() => {
      expect(namedInput(mounted!.container, 'Email').value).toBe(SAMPLE_USER.email);
    });
    const name = namedInput(mounted.container, 'Tên hiển thị');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(name, 'Bang Updated');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = Array.from(mounted.container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Lưu tên hiển thị'));
    await act(async () => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(namedInput(mounted!.container, 'Tên hiển thị').value).toBe('Bang Updated');
    });
  });

  it('rolls back the display name when the update fails', async () => {
    const account = createFakeAccount({
      updateProfile: async () => {
        throw new CloudApiError('Request validation failed.', 400, {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          request_id: 'r',
        }, 'VALIDATION_ERROR');
      },
    });
    mounted = mount(<Tree env={environment(account)} />);
    await waitFor(() => {
      expect(namedInput(mounted!.container, 'Tên hiển thị').value).toBe('Bang');
    });
    const name = namedInput(mounted.container, 'Tên hiển thị');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(name, 'Nope');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = Array.from(mounted.container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Lưu tên hiển thị'));
    await act(async () => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(namedInput(mounted!.container, 'Tên hiển thị').value).toBe('Bang');
      expect(mounted?.container.textContent).toContain('Không lưu được tên hiển thị');
    });
  });

  it('logs out from the account section', async () => {
    const account = createFakeAccount();
    mounted = mount(<Tree env={environment(account)} />);
    await waitFor(() => {
      expect(namedInput(mounted!.container, 'Email').value).toBe(SAMPLE_USER.email);
    });
    const logout = Array.from(mounted.container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Đăng xuất'));
    await act(async () => {
      logout?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => {
      expect(account.calls).toContain('logout');
      expect(mounted?.container.textContent).not.toContain(SAMPLE_USER.email);
    });
  });
});

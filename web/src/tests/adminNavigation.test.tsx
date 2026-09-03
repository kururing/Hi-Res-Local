/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../components/layout/Sidebar';
import { AdminCapabilitiesProvider } from '../context/AdminCapabilitiesContext';
import { AuthProvider } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { AuthSessionController } from '../auth/AuthSessionController';
import { PlatformProvider, type RuntimeEnvironment } from '../platform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { createFakeAccount } from './support/auth';
import { createFakeAdmin } from './support/admin';
import { t } from '../i18n';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

vi.mock('../context/PlaylistContext', () => ({
  usePlaylists: () => ({
    playlists: [],
    createPlaylist: vi.fn(),
    importM3uFile: vi.fn(),
    getPlaylistTracks: () => [],
    updatePlaylist: vi.fn(),
    deletePlaylist: vi.fn(),
    changePlaylistCover: vi.fn(),
  }),
}));

vi.mock('../context/PlayerContext', () => ({
  usePlayer: () => ({
    status: { state: 'stopped' },
    activePlaylistId: null,
  }),
}));

vi.mock('../context/LibraryContext', () => ({
  useLibrary: () => ({
    stats: { total_tracks: 0, total_albums: 0, total_artists: 0 },
  }),
}));

function environment(catalogAdmin: boolean) {
  const account = createFakeAccount();
  const admin = createFakeAdmin({ catalogAdmin });
  const platform = createWebPlatform('/api');
  return {
    platform: { ...platform, account, admin },
    authSession: new AuthSessionController({ account, enabled: true, broadcast: null }),
  } satisfies RuntimeEnvironment;
}

function Tree({ env }: { env: RuntimeEnvironment }) {
  return (
    <PlatformProvider environment={env}>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <AdminCapabilitiesProvider>
              <Sidebar currentView="home" onNavigate={vi.fn()} />
            </AdminCapabilitiesProvider>
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

async function waitFor(assert: () => void, timeout = 2000) {
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

describe('admin navigation', () => {
  const fixtures: Array<{ unmount(): void }> = [];
  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.unmount();
  });

  it('hides the catalog admin entry for a regular user', async () => {
    const view = mount(<Tree env={environment(false)} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('nav_settings', 'vi')));
    expect(view.container.textContent).not.toContain(t('nav_admin', 'vi'));
  });

  it('shows the catalog admin entry after capabilities load for an admin', async () => {
    const view = mount(<Tree env={environment(true)} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('nav_admin', 'vi')));
  });
});

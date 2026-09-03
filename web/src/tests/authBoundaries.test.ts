import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HybridLibraryApi } from '../platform/hybrid/HybridLibraryApi';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriRuntimeEnvironment } from '../platform/environment';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('auth persistence and fetch boundaries', () => {
  it('does not persist access tokens in the session controller or AuthContext', () => {
    const auth = source('../auth/AuthSessionController.ts');
    const context = source('../context/AuthContext.tsx');
    expect(auth).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(context).not.toMatch(/localStorage|sessionStorage/);
    expect(auth).not.toMatch(/console\.(log|debug|info).*token/i);
  });

  it('keeps UI and React contexts off raw fetch', () => {
    const files = [
      '../context/AuthContext.tsx',
      '../context/LibraryContext.tsx',
      '../context/PlaylistContext.tsx',
      '../context/PlayerContext.tsx',
      '../context/SettingsContext.tsx',
      '../components/auth/AuthGate.tsx',
      '../components/auth/AuthForm.tsx',
      '../components/auth/LoginView.tsx',
      '../components/auth/RegisterView.tsx',
      '../components/auth/AccountSettingsSection.tsx',
      '../components/views/AccountView.tsx',
      '../components/views/SettingsView.tsx',
      '../context/AdminCapabilitiesContext.tsx',
      '../components/views/admin/AdminCatalogView.tsx',
      '../components/layout/Sidebar.tsx',
      '../components/layout/UserMenu.tsx',
      '../components/layout/AppShell.tsx',
    ];
    for (const file of files) {
      expect(source(file), file).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('exposes optional account on desktop and required account on web', () => {
    expect(createWebPlatform('/api').capabilities.account).toBe(true);
    expect(createWebPlatform('/api').capabilities.accountRequired).toBe(true);
    expect(createWebPlatform('/api').account).not.toBeNull();
    expect(createMockPlatform().capabilities.account).toBe(false);
    expect(createMockPlatform().account).toBeNull();
    expect(createTauriPlatform().capabilities.account).toBe(true);
    expect(createTauriPlatform().capabilities.accountRequired).toBe(false);
    expect(createTauriPlatform().account).toBeNull();
    expect(createTauriPlatform().capabilities.adminCatalog).toBe(false);
  });

  it('exposes admin catalog API only as a web capability, never as a trusted client role', () => {
    expect(createWebPlatform('/api').capabilities.adminCatalog).toBe(true);
    expect(createWebPlatform('/api').admin).not.toBeNull();
    expect(createMockPlatform().capabilities.adminCatalog).toBe(false);
    expect(createTauriPlatform().capabilities.adminCatalog).toBe(false);
  });

  it('wires optional cloud account onto the Tauri runtime environment', () => {
    const env = createTauriRuntimeEnvironment('/api');
    expect(env.platform.account).not.toBeNull();
    expect(env.platform.library).toBeInstanceOf(HybridLibraryApi);
    expect(env.platform.capabilities.accountRequired).toBe(false);
    expect(env.platform.capabilities.adminCatalog).toBe(false);
    env.authSession.destroy();
  });
});

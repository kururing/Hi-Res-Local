import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TauriAutostartApi } from '../platform/autostart/TauriAutostartApi';
import { PlatformUnsupportedError } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockRuntime } from '../platform/mock/MockRuntime';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebAutostartApi } from '../platform/web/WebAutostartApi';

const {
  mockIsEnabled,
  mockEnable,
  mockDisable,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(async () => false),
  mockEnable: vi.fn(async () => undefined),
  mockDisable: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: () => mockIsEnabled(),
  enable: () => mockEnable(),
  disable: () => mockDisable(),
}));

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('TauriAutostartApi', () => {
  it('calls the Tauri plugin and does not leak plugin types into the contract', async () => {
    mockIsEnabled.mockResolvedValueOnce(true);
    const api = new TauriAutostartApi();

    await expect(api.isEnabled()).resolves.toBe(true);
    await api.enable();
    await api.disable();
    await api.setEnabled(true);
    await api.setEnabled(false);

    expect(mockIsEnabled).toHaveBeenCalledTimes(1);
    expect(mockEnable).toHaveBeenCalledTimes(2);
    expect(mockDisable).toHaveBeenCalledTimes(2);
    expect(source('../platform/contracts.ts')).not.toMatch(/@tauri-apps\/plugin-autostart/);
  });
});

describe('MockAutostartApi', () => {
  it('stores the enabled flag in the shared runtime store', async () => {
    const runtime = new MockRuntime({ persist: false });
    expect(await runtime.autostart.isEnabled()).toBe(false);
    await runtime.autostart.enable();
    expect(await runtime.autostart.isEnabled()).toBe(true);
    await runtime.autostart.setEnabled(false);
    expect(await runtime.autostart.isEnabled()).toBe(false);
  });
});

describe('WebAutostartApi', () => {
  it('reports disabled and rejects mutation as unsupported', async () => {
    const api = new WebAutostartApi();
    await expect(api.isEnabled()).resolves.toBe(false);
    await expect(api.enable()).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.disable()).rejects.toBeInstanceOf(PlatformUnsupportedError);
    await expect(api.setEnabled(true)).rejects.toBeInstanceOf(PlatformUnsupportedError);
  });
});

describe('platform wiring', () => {
  it('exposes autostart capability only where the OS login item exists', () => {
    expect(createTauriPlatform().capabilities.autostart).toBe(true);
    expect(createMockPlatform().capabilities.autostart).toBe(true);
    expect(createWebPlatform('/api').capabilities.autostart).toBe(false);
    expect(createWebPlatform('/api').autostart).toBeInstanceOf(WebAutostartApi);
  });
});

describe('SettingsView autostart', () => {
  it('does not import the Tauri plugin and skips mutation when capability is false', () => {
    const contents = source('../components/views/SettingsView.tsx');
    expect(contents).not.toMatch(/@tauri-apps\/plugin-autostart/);
    expect(contents).toMatch(/platform\.autostart|autostart\.setEnabled|autostart\.isEnabled/);
    expect(contents).toMatch(/if \(!canUseAutostart\) return/);
    expect(contents).toMatch(/disabled=\{!canUseAutostart \|\| isUpdatingStartup\}/);
  });
});

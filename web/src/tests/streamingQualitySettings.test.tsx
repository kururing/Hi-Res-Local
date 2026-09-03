/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudioEngine } from '../audio/BrowserAudioEngine';
import { SettingsView } from '../components/views/SettingsView';
import { AuthProvider } from '../context/AuthContext';
import { LibraryProvider } from '../context/LibraryContext';
import { PlayerProvider } from '../context/PlayerContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { PlatformProvider } from '../platform';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockRuntime } from '../platform/mock/MockRuntime';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import {
  DEFAULT_SETTINGS,
  normalizeAudioSettings,
  normalizeStreamingQuality,
} from '../types/settings';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function withSafeLibrary<T extends {
  library: unknown;
  history: unknown;
  playlists: unknown;
  favorites: unknown;
  audioConfiguration: unknown;
  autostart: unknown;
  capabilities: { account?: boolean };
}>(platform: T): T {
  const mock = createMockPlatform(new MockRuntime({ persist: false }));
  return {
    ...platform,
    library: mock.library,
    history: mock.history,
    playlists: mock.playlists,
    favorites: mock.favorites,
    audioConfiguration: mock.audioConfiguration,
    autostart: mock.autostart,
    capabilities: { ...platform.capabilities, account: false },
  };
}

function SettingsTree({
  platform,
  children,
}: {
  platform: ReturnType<typeof createWebPlatform> | ReturnType<typeof createMockPlatform> | ReturnType<typeof createTauriPlatform>;
  children: React.ReactNode;
}) {
  return (
    <PlatformProvider platform={platform}>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <LibraryProvider>
              <PlayerProvider>
                {children}
              </PlayerProvider>
            </LibraryProvider>
          </AuthProvider>
        </SettingsProvider>
      </ToastProvider>
    </PlatformProvider>
  );
}

function mountSettings(
  platform: ReturnType<typeof createWebPlatform> | ReturnType<typeof createMockPlatform> | ReturnType<typeof createTauriPlatform>
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <SettingsTree platform={platform}>
        <SettingsView />
      </SettingsTree>
    );
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('streaming quality setting', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'vi';
  });

  it('defaults and migrates missing or invalid values to original', () => {
    expect(DEFAULT_SETTINGS.streaming_quality).toBe('maximum');
    expect(normalizeStreamingQuality(undefined)).toBe('maximum');
    expect(normalizeStreamingQuality('turbo')).toBe('maximum');
    expect(normalizeStreamingQuality('max')).toBe('maximum');
    expect(normalizeStreamingQuality('lossless')).toBe('maximum');
    expect(normalizeAudioSettings({
      ...DEFAULT_SETTINGS,
      streaming_quality: 'nope' as never,
    }).streaming_quality).toBe('maximum');
  });

  it('hides source-quality controls on web and desktop while retaining audio settings', () => {
    const settings = source('../components/views/SettingsView.tsx');
    expect(settings).not.toMatch(/name="streaming-quality"/);
    expect(settings).not.toMatch(/settings_streaming_quality_hint/);

    const web = mountSettings(withSafeLibrary(createWebPlatform('/api')));
    expect(web.container.querySelector('input[name="streaming-quality"]')).toBeNull();
    expect(web.container.textContent).not.toContain('Quản lý Thư viện Nhạc');
    expect(web.container.textContent).not.toContain('Tải ảnh còn thiếu');
    expect(web.container.textContent).not.toContain('Chất lượng nguồn phát');
    expect(web.container.textContent).not.toContain('Chế độ phát nhạc');
    expect(web.container.textContent).toContain('Trạng thái hiện tại');
    expect(web.container.textContent).toContain('Chọn thiết bị trình duyệt được phép sử dụng');
    expect(web.container.textContent).not.toContain('Năng lực DAC đã xác minh');
    expect(web.container.querySelectorAll('input[name="playback-mode"]')).toHaveLength(0);
    expect(web.container.querySelector('#audio-backend')).toBeNull();
    expect(web.container.querySelector('#dsd-transport')).toBeNull();
    expect(web.container.textContent).toContain('nnpm-audio-core');
    expect(document.documentElement.lang).toBe('vi');
    const language = web.container.querySelector<HTMLSelectElement>('#settings-language');
    expect(language).toBeTruthy();
    act(() => {
      if (!language) return;
      language.value = 'en';
      language.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.documentElement.lang).toBe('en');
    expect(web.container.querySelector('#audio-output-device')).toBeTruthy();
    expect(web.container.querySelector('#audio-output-device')).toHaveProperty('disabled', true);
    expect(web.container.textContent).not.toContain('Sao lưu & Phục hồi');
    web.unmount();
    localStorage.clear();
    document.documentElement.lang = 'vi';

    const tauri = mountSettings(withSafeLibrary(createTauriPlatform()));
    expect(tauri.container.querySelector('input[name="streaming-quality"]')).toBeNull();
    expect(tauri.container.textContent).not.toContain('Chất lượng nguồn phát');
    expect(tauri.container.textContent).not.toContain('Trình duyệt dùng thiết bị mặc định');
    expect(tauri.container.textContent).toContain('Quản lý Thư viện Nhạc');
    expect(tauri.container.querySelector('#audio-output-device')).toBeTruthy();
    expect(tauri.container.textContent).toContain('Sao lưu & Phục hồi');
    tauri.unmount();

    const mock = mountSettings(createMockPlatform());
    expect(mock.container.querySelector('input[name="streaming-quality"]')).toBeNull();
    mock.unmount();
  });

  it('does not restart the current track when quality changes', async () => {
    const playTrack = vi.fn();
    const engine = new BrowserAudioEngine({
      streaming: { createStream: async () => { throw new Error('unused'); } },
      getQuality: () => 'auto',
    });
    engine.playTrack = playTrack;
    const platform = {
      ...withSafeLibrary(createWebPlatform('/api')),
      audioEngine: engine,
    };

    let updateSettings: ((partial: { streaming_quality: 'max' }) => void) | null = null;
    const Capture = () => {
      const settings = useSettings();
      updateSettings = settings.updateSettings;
      return <SettingsView />;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <SettingsTree platform={platform}>
          <Capture />
        </SettingsTree>
      );
    });

    act(() => {
      updateSettings?.({ streaming_quality: 'max' });
    });
    expect(playTrack).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});

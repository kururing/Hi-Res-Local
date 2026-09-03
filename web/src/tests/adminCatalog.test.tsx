/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCatalogView } from '../components/views/admin/AdminCatalogView';
import { AdminCapabilitiesProvider, useAdminCapabilities } from '../context/AdminCapabilitiesContext';
import { AuthProvider } from '../context/AuthContext';
import { SettingsProvider } from '../context/SettingsContext';
import { ToastProvider } from '../context/ToastContext';
import { AuthSessionController } from '../auth/AuthSessionController';
import { ObjectUploadTransport } from '../admin/ObjectUploadTransport';
import { PlatformProvider, type RuntimeEnvironment } from '../platform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { createFakeAccount } from './support/auth';
import { createFakeAdmin, sampleAlbum, sampleImport } from './support/admin';
import { t } from '../i18n';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

function environment(admin = createFakeAdmin()) {
  const account = createFakeAccount();
  const platform = createWebPlatform('/api');
  return {
    admin,
    env: {
      platform: { ...platform, account, admin },
      authSession: new AuthSessionController({ account, enabled: true, broadcast: null }),
    } satisfies RuntimeEnvironment,
  };
}

function RefreshCaps() {
  const { refresh } = useAdminCapabilities();
  return <button type="button" onClick={() => void refresh()}>refresh-caps</button>;
}

function Tree({
  env,
  onLeave,
  transport,
}: {
  env: RuntimeEnvironment;
  onLeave?: () => void;
  transport?: ObjectUploadTransport;
}) {
  return (
    <PlatformProvider environment={env}>
      <ToastProvider>
        <SettingsProvider>
          <AuthProvider>
            <AdminCapabilitiesProvider>
              <RefreshCaps />
              <AdminCatalogView onLeave={onLeave} transport={transport} />
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

function click(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button, summary'))
    .find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return button;
}

async function assignFiles(input: HTMLInputElement, files: File[]) {
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function audioInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[type="file"][multiple]');
}

describe('admin catalog view', () => {
  const fixtures: Array<{ unmount(): void }> = [];
  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.unmount();
  });

  it('hides the view for users without catalog_admin', async () => {
    const { admin, env } = environment(createFakeAdmin({ catalogAdmin: false }));
    const onLeave = vi.fn();
    const view = mount(<Tree env={env} onLeave={onLeave} />);
    fixtures.push(view);
    await waitFor(() => expect(admin.calls).toContain('getCapabilities'));
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
    expect(view.container.textContent).not.toContain(t('admin_upload_music', 'vi'));
    expect(view.container.textContent).not.toContain(t('admin_artwork_heading', 'vi'));
  });

  it('loads capabilities after auth and closes when the role is revoked', async () => {
    const admin = createFakeAdmin({ catalogAdmin: true });
    const { env } = environment(admin);
    const onLeave = vi.fn();
    const view = mount(<Tree env={env} onLeave={onLeave} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_title', 'vi')));
    admin.setCatalogAdmin(false);
    click(view.container, 'refresh-caps');
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
  });

  it('offers a keyboard-accessible multi file picker and a dropzone', async () => {
    const { env } = environment();
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_upload_music', 'vi')));
    const picker = Array.from(view.container.querySelectorAll('button'))
      .find(item => item.textContent?.includes(t('admin_upload_music', 'vi')));
    expect(picker?.tagName).toBe('BUTTON');
    const input = audioInput(view.container);
    expect(input).toBeTruthy();
    expect(input?.multiple).toBe(true);
    expect(view.container.textContent).toContain(t('admin_drop_files', 'vi'));
    expect(view.container.querySelector('[data-admin-catalog]')?.className).toContain('view-page');
  });

  it('uploads more than one selected file and reports progress that can be cancelled', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const transport = {
      put: vi.fn(async (request: { onProgress?: (progress: { bytesSent: number; totalBytes: number; percent: number }) => void }) => {
        request.onProgress?.({ bytesSent: 2, totalBytes: 4, percent: 50 });
        await held;
      }),
    } as unknown as ObjectUploadTransport;
    const view = mount(<Tree env={env} transport={transport} />);
    fixtures.push(view);
    await waitFor(() => expect(audioInput(view.container)).toBeTruthy());
    await assignFiles(audioInput(view.container)!, [
      new File([new Uint8Array([1, 2, 3, 4])], 'one.flac', { type: 'audio/flac' }),
      new File([new Uint8Array([5, 6, 7, 8])], 'two.flac', { type: 'audio/flac' }),
    ]);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_import_status_uploading', 'vi')));
    expect(view.container.querySelector('[role="progressbar"]')).toBeTruthy();
    click(view.container, t('admin_cancel_upload', 'vi'));
    release();
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_import_status_cancelled', 'vi')));
    expect(admin.calls).toContain('createImport');
  });

  it('accepts a dropped file as an alternative to the picker', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const transport = {
      put: vi.fn(async () => undefined),
    } as unknown as ObjectUploadTransport;
    const view = mount(<Tree env={env} transport={transport} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_drop_files', 'vi')));
    const zone = view.container.querySelector('.border-dashed');
    expect(zone).toBeTruthy();
    await act(async () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [new File([new Uint8Array([1, 2])], 'drop.flac', { type: 'audio/flac' })] },
      });
      zone?.dispatchEvent(event);
    });
    await waitFor(() => expect(admin.calls).toContain('createImport'));
  });

  it('retries a failed upload and ignores stale progress from a cancelled generation', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    let attempt = 0;
    const transport = {
      put: vi.fn(async (request: { onProgress?: (progress: { bytesSent: number; totalBytes: number; percent: number }) => void }) => {
        attempt += 1;
        if (attempt === 1) {
          request.onProgress?.({ bytesSent: 1, totalBytes: 4, percent: 25 });
          throw new Error('Object upload failed with status 500.');
        }
        request.onProgress?.({ bytesSent: 4, totalBytes: 4, percent: 100 });
      }),
    } as unknown as ObjectUploadTransport;
    const view = mount(<Tree env={env} transport={transport} />);
    fixtures.push(view);
    await waitFor(() => expect(audioInput(view.container)).toBeTruthy());
    await assignFiles(audioInput(view.container)!, [
      new File([new Uint8Array([9, 8, 7, 6])], 'track.flac', { type: 'audio/flac' }),
    ]);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_import_status_failed', 'vi')));
    click(view.container, t('admin_retry', 'vi'));
    await waitFor(() => expect(transport.put).toHaveBeenCalledTimes(2));
  });

  it('restores imports after refresh without a metadata or rights form', async () => {
    const admin = createFakeAdmin({
      imports: [sampleImport({
        id: 'import-restore',
        status: 'published',
        original_filename: 'night-drive.flac',
        committed_track_id: 'track-restore',
      })],
    });
    const { env } = environment(admin);
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(admin.calls).toContain('listImports'));
    await waitFor(() => expect(view.container.textContent).toContain('night-drive.flac'));
    expect(view.container.textContent).toContain(t('admin_import_status_published', 'vi'));
    expect(view.container.textContent).not.toContain(t('admin_field_title', 'vi'));
    expect(view.container.textContent).not.toContain(t('admin_rights_holder', 'vi'));
    expect(view.container.textContent).not.toContain(t('admin_publish_one', 'vi'));
    expect(view.container.textContent).not.toContain(t('admin_advanced', 'vi'));
  });

  it('does not show metadata or rights forms on the default admin screen', async () => {
    const { env } = environment();
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_upload_music', 'vi')));
    expect(view.container.querySelector('input[name="title"]')).toBeNull();
    expect(view.container.textContent).not.toContain(t('admin_rights_attestation', 'vi'));
    expect(view.container.textContent).not.toContain(t('admin_continue_upload', 'vi'));
    expect(view.container.textContent).toContain(t('admin_scan_existing', 'vi'));
  });

  it('ignores a second selection of the same file', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const transport = {
      put: vi.fn(async () => undefined),
    } as unknown as ObjectUploadTransport;
    const view = mount(<Tree env={env} transport={transport} />);
    fixtures.push(view);
    await waitFor(() => expect(audioInput(view.container)).toBeTruthy());
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'same.flac', { type: 'audio/flac' });
    Object.defineProperty(file, 'lastModified', { value: 1 });
    await assignFiles(audioInput(view.container)!, [file]);
    await assignFiles(audioInput(view.container)!, [file]);
    await waitFor(() => expect(admin.calls.filter(item => item === 'createImport')).toHaveLength(1));
  });

  it('does not persist a presigned URL on the page', async () => {
    const { env } = environment();
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_title', 'vi')));
    expect(view.container.innerHTML).not.toContain('https://storage.test/presigned');
  });

  it('aborts an in-flight upload when the session is no longer authenticated', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const abort = vi.fn();
    const transport = {
      put: vi.fn(async (request: { signal?: AbortSignal }) => {
        request.signal?.addEventListener('abort', abort);
        await new Promise(() => undefined);
      }),
    } as unknown as ObjectUploadTransport;
    const view = mount(<Tree env={env} transport={transport} />);
    fixtures.push(view);
    await waitFor(() => expect(audioInput(view.container)).toBeTruthy());
    await assignFiles(audioInput(view.container)!, [
      new File([new Uint8Array([1, 2, 3, 4])], 'track.flac', { type: 'audio/flac' }),
    ]);
    await waitFor(() => expect(transport.put).toHaveBeenCalled());
    await act(async () => {
      await env.authSession.logout();
    });
    await waitFor(() => expect(abort).toHaveBeenCalled());
  });

  it('scans existing storage objects from a single admin action', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_scan_existing', 'vi')));
    click(view.container, t('admin_scan_existing', 'vi'));
    await waitFor(() => expect(admin.calls).toContain('reconcileImports'));
  });

  it('lists artists and albums for artwork upload and sends an artist photo through the admin pipeline', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const transport = {
      put: vi.fn(async () => undefined),
    } as unknown as ObjectUploadTransport;
    const view = mount(<Tree env={env} transport={transport} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_artwork_heading', 'vi')));
    expect(view.container.textContent).toContain('Demo Artist');
    expect(view.container.textContent).toContain('Demo Album');
    expect(admin.calls).toContain('listArtists');
    expect(admin.calls).toContain('listAlbums');

    const picker = view.container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/jpeg"]');
    expect(picker).toBeTruthy();
    await assignFiles(picker!, [
      new File([new Uint8Array([1, 2, 3, 4])], 'portrait.jpg', { type: 'image/jpeg' }),
    ]);
    await waitFor(() => expect(admin.calls).toContain('initArtworkUpload'));
    await waitFor(() => expect(transport.put).toHaveBeenCalled());
    await waitFor(() => expect(admin.calls).toContain('completeUpload'));
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toContain('cdn.example.test/artwork'));
  });

  it('stores an iTunes artwork link without uploading a file', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.textContent).toContain(t('admin_artwork_fetch_missing', 'vi')));
    click(view.container, t('admin_artwork_fetch', 'vi'));
    await waitFor(() => expect(admin.calls).toContain('lookupArtistArtwork'));
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toContain('mzstatic.com'));

    click(view.container, t('admin_artwork_fetch_missing', 'vi'));
    await waitFor(() => expect(admin.calls).toContain('lookupMissingArtwork'));
    await waitFor(() => {
      const images = [...view.container.querySelectorAll('img')].map(item => item.getAttribute('src') ?? '');
      expect(images.some(src => src.includes('Features/artist.jpg'))).toBe(true);
      expect(images.some(src => src.includes('Music/cover.jpg'))).toBe(true);
    });
  });

  it('shows Lấy link for an album without a cover and stores the iTunes URL', async () => {
    const admin = createFakeAdmin();
    const { env } = environment(admin);
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.querySelector('[data-admin-artwork-fetch="album"]')).toBeTruthy());
    act(() => {
      view.container.querySelector<HTMLButtonElement>('[data-admin-artwork-fetch="album"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(admin.calls).toContain('lookupAlbumArtwork'));
    await waitFor(() => {
      const images = [...view.container.querySelectorAll('img')].map(item => item.getAttribute('src') ?? '');
      expect(images.some(src => src.includes('Music/cover.jpg'))).toBe(true);
    });
  });

  it('shows Lấy link when an album cover URL is broken', async () => {
    const admin = createFakeAdmin({
      albums: [sampleAlbum({ cover_url: 'https://cdn.example.test/covers/broken.jpg' })],
    });
    const { env } = environment(admin);
    const view = mount(<Tree env={env} />);
    fixtures.push(view);
    await waitFor(() => expect(view.container.querySelector('img[src*="broken.jpg"]')).toBeTruthy());
    expect(view.container.querySelector('[data-admin-artwork-fetch="album"]')).toBeNull();
    act(() => {
      view.container.querySelector('img[src*="broken.jpg"]')?.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(view.container.querySelector('[data-admin-artwork-fetch="album"]')).toBeTruthy());
    act(() => {
      view.container.querySelector<HTMLButtonElement>('[data-admin-artwork-fetch="album"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(admin.calls).toContain('lookupAlbumArtwork'));
    await waitFor(() => {
      const images = [...view.container.querySelectorAll('img')].map(item => item.getAttribute('src') ?? '');
      expect(images.some(src => src.includes('Music/cover.jpg'))).toBe(true);
    });
  });
});

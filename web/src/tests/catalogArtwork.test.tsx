/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlbumArtwork } from '../components/common/AlbumArtwork';
import { RemoteArtwork } from '../components/common/RemoteArtwork';
import { PlatformProvider } from '../platform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import type { Album } from '../types/library';
import './support/localStorage';

vi.mock('../loadAppFonts', () => ({
  loadAppFont: async () => undefined,
}));

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

const album: Album = {
  id: 'album-1',
  name: 'Glass Harbor',
  artist: 'Aurora Circuit',
  track_count: 1,
  total_duration: 214,
  cover_url: 'https://cdn.example.test/covers/glass-harbor.jpg',
  tracks: [{
    id: 'track-1',
    title: 'Lanterns',
    artist: 'Aurora Circuit',
    album: 'Glass Harbor',
    duration: 214,
    path: '',
    date_added: '2026-01-01T00:00:00.000Z',
    cover_art_path: 'https://cdn.example.test/covers/glass-harbor.jpg',
  }],
};

describe('catalog artwork display', () => {
  const fixtures: Array<{ unmount(): void }> = [];
  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.unmount();
    localStorage.clear();
  });

  it('uses a catalog artist portrait instead of the iTunes cache', () => {
    localStorage.setItem('nghenhac_remote_artwork_itunes_v3', JSON.stringify({
      'artist:aurora circuit:': 'https://itunes.example/wrong.jpg',
    }));
    const view = mount(
      <RemoteArtwork
        kind="artist"
        artist="Aurora Circuit"
        src="https://cdn.example.test/artists/aurora.jpg"
        alt="Aurora Circuit portrait"
      />,
    );
    fixtures.push(view);
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/artists/aurora.jpg');
    expect(view.container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('prefers catalog album covers over cached iTunes artwork', async () => {
    localStorage.setItem('nghenhac_remote_artwork_itunes_v3', JSON.stringify({
      'album:aurora circuit:glass harbor': 'https://itunes.example/wrong-cover.jpg',
    }));
    const view = mount(
      <PlatformProvider platform={createWebPlatform('/api')}>
        <AlbumArtwork album={album} alt="Glass Harbor cover" />
      </PlatformProvider>,
    );
    fixtures.push(view);
    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (view.container.querySelector('img')?.getAttribute('src') === 'https://cdn.example.test/covers/glass-harbor.jpg') {
        break;
      }
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
      });
    }
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/covers/glass-harbor.jpg');
    expect(view.container.innerHTML).not.toContain('itunes.example');
  });
});

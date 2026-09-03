import React, { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { WindowTitleBar } from './WindowTitleBar';
import { PlayerBar } from '../player/PlayerBar';
import { QueueDrawer } from '../player/QueueDrawer';
import { EqualizerModal } from '../player/EqualizerModal';
import { TrackDetailsModal } from '../views/TrackDetailsModal';
import { ArtworkAdaptiveTheme } from './ArtworkAdaptiveTheme';
import { usePlayer } from '../../context/PlayerContext';
import { useAdminCapabilities } from '../../context/AdminCapabilitiesContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';

import { HomeView } from '../views/HomeView';

const TracksView = lazy(() => import('../views/TracksView').then(module => ({ default: module.TracksView })));
const AlbumsView = lazy(() => import('../views/AlbumsView').then(module => ({ default: module.AlbumsView })));
const AlbumDetailView = lazy(() => import('../views/AlbumDetailView').then(module => ({ default: module.AlbumDetailView })));
const ArtistsView = lazy(() => import('../views/ArtistsView').then(module => ({ default: module.ArtistsView })));
const ArtistDetailView = lazy(() => import('../views/ArtistDetailView').then(module => ({ default: module.ArtistDetailView })));
const GenresView = lazy(() => import('../views/GenresView').then(module => ({ default: module.GenresView })));
const GenreDetailView = lazy(() => import('../views/GenreDetailView').then(module => ({ default: module.GenreDetailView })));
const FavoritesView = lazy(() => import('../views/FavoritesView').then(module => ({ default: module.FavoritesView })));
const PlaylistsView = lazy(() => import('../views/PlaylistsView').then(module => ({ default: module.PlaylistsView })));
const PlaylistDetailView = lazy(() => import('../views/PlaylistDetailView').then(module => ({ default: module.PlaylistDetailView })));
const HistoryView = lazy(() => import('../views/HistoryView').then(module => ({ default: module.HistoryView })));
const LyricsView = lazy(() => import('../views/LyricsView').then(module => ({ default: module.LyricsView })));
const SettingsView = lazy(() => import('../views/SettingsView').then(module => ({ default: module.SettingsView })));
const AccountView = lazy(() => import('../views/AccountView').then(module => ({ default: module.AccountView })));
const AdminCatalogView = lazy(() => import('../views/admin/AdminCatalogView').then(module => ({ default: module.AdminCatalogView })));

import { Album, Artist, Genre, Track } from '../../types/library';
import { Playlist } from '../../types/playlist';
import { usePlatform } from '../../platform';

interface HistoryEntry {
  view: string;
  payload?: unknown;
}

interface NavigationState {
  entries: HistoryEntry[];
  index: number;
}

const isSameDestination = (current: HistoryEntry, view: string, payload?: unknown) => {
  if (current.view !== view) return false;
  if (current.payload === payload) return true;
  if (!current.payload || !payload || typeof current.payload !== 'object' || typeof payload !== 'object') {
    return false;
  }

  const currentId = (current.payload as { id?: unknown }).id;
  const nextId = (payload as { id?: unknown }).id;
  return currentId !== undefined && nextId !== undefined && currentId === nextId;
};

export const AppShell: React.FC = () => {
  const mainRef = useRef<HTMLElement>(null);
  const { togglePlayPause } = usePlayer();
  const { window: windowApi, capabilities } = usePlatform();
  const { catalogAdmin } = useAdminCapabilities();
  const { settings } = useSettings();
  const [adminUploadBusy, setAdminUploadBusy] = useState(false);
  const [navigation, setNavigation] = useState<NavigationState>({
    entries: [{ view: 'home' }],
    index: 0,
  });

  const [selectedTrackDetails, setSelectedTrackDetails] = useState<Track | null>(null);
  const [isTrackDetailsOpen, setIsTrackDetailsOpen] = useState(false);

  useEffect(() => {
    const handlePlaybackShortcut = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const isEditable = target.isContentEditable
          || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
          || target.closest('[contenteditable="true"], [role="textbox"], [role="slider"], [role="button"], [role="menu"]');
        if (isEditable) return;
      }

      event.preventDefault();
      void togglePlayPause();
    };

    window.addEventListener('keydown', handlePlaybackShortcut);
    return () => window.removeEventListener('keydown', handlePlaybackShortcut);
  }, [togglePlayPause]);

  useEffect(() => {
    const root = document.documentElement;
    let settleTimer: number | undefined;
    let unlistenNativeResize: (() => void) | undefined;
    let disposed = false;

    const handleResize = () => {
      root.classList.add('is-window-resizing');
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        root.classList.remove('is-window-resizing');
        settleTimer = undefined;
      }, 120);
    };

    void windowApi.subscribeResize(handleResize)
      .then(unlisten => {
        if (disposed) unlisten();
        else unlistenNativeResize = unlisten;
      })
      .catch(error => console.warn('Failed to subscribe to resize events', error));

    return () => {
      disposed = true;
      unlistenNativeResize?.();
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      root.classList.remove('is-window-resizing');
    };
  }, [windowApi]);

  const currentEntry = navigation.entries[navigation.index] || { view: 'home' };
  const currentView = currentEntry.view;
  const currentPayload = currentEntry.payload;
  const [hasVisitedSettings, setHasVisitedSettings] = useState(currentView === 'settings');

  useEffect(() => {
    const frame = requestAnimationFrame(() => mainRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [currentView]);

  useEffect(() => {
    if (currentView === 'settings') setHasVisitedSettings(true);
  }, [currentView]);

  useEffect(() => {
    if (currentView === 'admin' && !catalogAdmin) {
      setNavigation({ entries: [{ view: 'home' }], index: 0 });
    }
  }, [catalogAdmin, currentView]);

  useEffect(() => {
    if (currentView === 'account' && !capabilities.account) {
      setNavigation({ entries: [{ view: 'home' }], index: 0 });
    }
  }, [capabilities.account, currentView]);

  const navigate = useCallback((view: string, payload?: unknown) => {
    setNavigation(previous => {
      const leavingAdmin = previous.entries[previous.index]?.view === 'admin' && view !== 'admin';
      if (leavingAdmin && adminUploadBusy) {
        const confirmed = window.confirm(t('admin_leave_upload', settings.language));
        if (!confirmed) return previous;
      }
      const current = previous.entries[previous.index];
      if (current && isSameDestination(current, view, payload)) return previous;

      const entries = [
        ...previous.entries.slice(0, previous.index + 1),
        { view, payload },
      ];
      return { entries, index: entries.length - 1 };
    });
  }, [adminUploadBusy, settings.language]);

  const goBack = useCallback(() => {
    setNavigation(previous => previous.index > 0
      ? { ...previous, index: previous.index - 1 }
      : previous);
  }, []);

  const goForward = useCallback(() => {
    setNavigation(previous => previous.index < previous.entries.length - 1
      ? { ...previous, index: previous.index + 1 }
      : previous);
  }, []);

  const toggleNowPlaying = useCallback(() => {
    if (currentView === 'lyrics') {
      goBack();
      return;
    }

    navigate('lyrics');
  }, [currentView, goBack, navigate]);

  const openTrackDetails = (track: Track) => {
    setSelectedTrackDetails(track);
    setIsTrackDetailsOpen(true);
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'home':
        return <HomeView onNavigate={navigate} />;
      case 'tracks':
        return <TracksView onNavigate={navigate} onOpenDetails={openTrackDetails} />;
      case 'albums':
        return <AlbumsView onNavigate={navigate} />;
      case 'album_detail':
        return (
          <AlbumDetailView
            album={currentPayload as Album}
            onNavigate={navigate}
            onOpenDetails={openTrackDetails}
          />
        );
      case 'artists':
        return <ArtistsView onNavigate={navigate} />;
      case 'artist_detail':
        return (
          <ArtistDetailView
            artist={currentPayload as Artist}
            onNavigate={navigate}
            onOpenDetails={openTrackDetails}
          />
        );
      case 'genres':
        return <GenresView onNavigate={navigate} />;
      case 'genre_detail':
        return (
          <GenreDetailView
            genre={currentPayload as Genre}
            onNavigate={navigate}
            onOpenDetails={openTrackDetails}
          />
        );
      case 'favorites':
        return <FavoritesView onNavigate={navigate} onOpenDetails={openTrackDetails} />;
      case 'playlists':
        return <PlaylistsView onNavigate={navigate} />;
      case 'playlist_detail':
        return (
          <PlaylistDetailView
            playlist={currentPayload as Playlist}
            onNavigate={navigate}
            onOpenDetails={openTrackDetails}
          />
        );
      case 'history':
        return <HistoryView onNavigate={navigate} />;
      case 'lyrics':
        return <LyricsView />;
      case 'settings':
        return null;
      case 'account':
        return <AccountView />;
      case 'admin':
        return catalogAdmin
          ? (
            <AdminCatalogView
              onLeave={() => navigate('home')}
              onBusyChange={setAdminUploadBusy}
            />
          )
          : null;
      default:
        return <HomeView onNavigate={navigate} />;
    }
  };

  const viewLoading = (
    <div className="flex h-full items-center justify-center text-sm text-brand-muted" role="status" aria-live="polite">
      Đang tải nội dung…
    </div>
  );

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-oled-base text-brand-foreground font-sans selection:bg-brand-secondary selection:text-white">
      <ArtworkAdaptiveTheme />
      <div className="custom-theme-backdrop" aria-hidden="true" />
      <WindowTitleBar />
      <div className="app-shell relative z-10 flex min-h-0 flex-1 overflow-hidden">
      {/* Skip to Main Content Link for Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-brand-accent focus:text-oled-base focus:font-bold focus:rounded-lg focus:shadow-glow-accent focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Left Sidebar */}
      <Sidebar currentView={currentView} onNavigate={navigate} />

      {/* Main View Area */}
      <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <Header
          currentView={currentView}
          onNavigate={navigate}
          canGoBack={navigation.index > 0}
          canGoForward={navigation.index < navigation.entries.length - 1}
          onGoBack={goBack}
          onGoForward={goForward}
        />

        {/* Scrollable View Content */}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="app-main min-h-0 flex-1 overflow-hidden focus:outline-none"
        >
          {currentView !== 'settings' && (
            <div key={currentView} className="view-stage">
              <Suspense fallback={viewLoading}>
                {renderCurrentView()}
              </Suspense>
            </div>
          )}
          {(currentView === 'settings' || hasVisitedSettings) && (
            <div className={currentView === 'settings' ? 'view-stage' : 'hidden'}>
              <Suspense fallback={viewLoading}>
                <SettingsView />
              </Suspense>
            </div>
          )}
        </main>

        {/* Player owns its space so scrollable content can never run underneath it. */}
        <div className="player-bar-shell relative z-30 shrink-0 px-3 pb-3 pt-2">
          <PlayerBar
            isNowPlayingOpen={currentView === 'lyrics'}
            onNavigateNowPlaying={toggleNowPlaying}
            onNavigateArtist={artist => navigate('artist_detail', artist)}
          />
        </div>
      </div>

      {/* Overlays & Modals */}
      <QueueDrawer />
      <EqualizerModal />
      <TrackDetailsModal
        track={selectedTrackDetails}
        isOpen={isTrackDetailsOpen}
        onClose={() => setIsTrackDetailsOpen(false)}
      />
      </div>
    </div>
  );
};

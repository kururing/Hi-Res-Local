import React, { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { PlayerBar } from '../player/PlayerBar';
import { NowPlayingExpanded } from '../player/NowPlayingExpanded';
import { QueueDrawer } from '../player/QueueDrawer';
import { EqualizerModal } from '../player/EqualizerModal';
import { TrackDetailsModal } from '../views/TrackDetailsModal';

import { HomeView } from '../views/HomeView';
import { TracksView } from '../views/TracksView';
import { AlbumsView } from '../views/AlbumsView';
import { AlbumDetailView } from '../views/AlbumDetailView';
import { ArtistsView } from '../views/ArtistsView';
import { ArtistDetailView } from '../views/ArtistDetailView';
import { GenresView } from '../views/GenresView';
import { GenreDetailView } from '../views/GenreDetailView';
import { FavoritesView } from '../views/FavoritesView';
import { PlaylistsView } from '../views/PlaylistsView';
import { PlaylistDetailView } from '../views/PlaylistDetailView';
import { HistoryView } from '../views/HistoryView';
import { LyricsView } from '../views/LyricsView';
import { SettingsView } from '../views/SettingsView';

import { Album, Artist, Genre, Track } from '../../types/library';
import { Playlist } from '../../types/playlist';

interface HistoryEntry {
  view: string;
  payload?: unknown;
}

export const AppShell: React.FC = () => {
  const [history, setHistory] = useState<HistoryEntry[]>([{ view: 'home' }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [selectedTrackDetails, setSelectedTrackDetails] = useState<Track | null>(null);
  const [isTrackDetailsOpen, setIsTrackDetailsOpen] = useState(false);

  const currentEntry = history[historyIndex] || { view: 'home' };
  const currentView = currentEntry.view;
  const currentPayload = currentEntry.payload;

  const navigate = useCallback((view: string, payload?: unknown) => {
    setHistory(prev => {
      const sliced = prev.slice(0, historyIndex + 1);
      return [...sliced, { view, payload }];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
    }
  }, [historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
    }
  }, [historyIndex, history.length]);

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
        return <SettingsView />;
      default:
        return <HomeView onNavigate={navigate} />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-oled-base text-brand-foreground font-sans selection:bg-brand-secondary selection:text-white">
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
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        {/* Top Header */}
        <Header
          currentView={currentView}
          onNavigate={navigate}
          canGoBack={historyIndex > 0}
          canGoForward={historyIndex < history.length - 1}
          onGoBack={goBack}
          onGoForward={goForward}
        />

        {/* Scrollable View Content */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto pb-28 focus:outline-none">
          {renderCurrentView()}
        </main>

        {/* Bottom Fixed Player Bar */}
        <div className="absolute bottom-0 left-0 right-0">
          <PlayerBar onNavigateLyrics={() => navigate('lyrics')} />
        </div>
      </div>

      {/* Overlays & Modals */}
      <NowPlayingExpanded />
      <QueueDrawer />
      <EqualizerModal />
      <TrackDetailsModal
        track={selectedTrackDetails}
        isOpen={isTrackDetailsOpen}
        onClose={() => setIsTrackDetailsOpen(false)}
      />
    </div>
  );
};

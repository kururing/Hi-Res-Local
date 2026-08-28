import React from 'react';
import { ToastProvider } from './context/ToastContext';
import { SettingsProvider } from './context/SettingsContext';
import { LibraryProvider } from './context/LibraryContext';
import { PlaylistProvider } from './context/PlaylistContext';
import { PlayerProvider } from './context/PlayerContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlaylistProvider>
              <PlayerProvider>
                <AppShell />
              </PlayerProvider>
            </PlaylistProvider>
          </LibraryProvider>
        </SettingsProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;

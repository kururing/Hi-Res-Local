import React from 'react';
import { ToastProvider } from './context/ToastContext';
import { SettingsProvider } from './context/SettingsContext';
import { LibraryProvider } from './context/LibraryContext';
import { PlaylistProvider } from './context/PlaylistContext';
import { PlayerProvider } from './context/PlayerContext';
import { AuthProvider } from './context/AuthContext';
import { AdminCapabilitiesProvider } from './context/AdminCapabilitiesContext';
import { AppShell } from './components/layout/AppShell';
import { AuthGate } from './components/auth/AuthGate';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { PlatformProvider } from './platform';

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <PlatformProvider>
        <ToastProvider>
          <SettingsProvider>
            <AuthProvider>
              <AdminCapabilitiesProvider>
                <AuthGate>
                  <LibraryProvider>
                    <PlaylistProvider>
                      <PlayerProvider>
                        <AppShell />
                      </PlayerProvider>
                    </PlaylistProvider>
                  </LibraryProvider>
                </AuthGate>
              </AdminCapabilitiesProvider>
            </AuthProvider>
          </SettingsProvider>
        </ToastProvider>
      </PlatformProvider>
    </ErrorBoundary>
  );
};

export default App;

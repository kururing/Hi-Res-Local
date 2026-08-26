import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { Track, Album, Artist, Genre, LibraryStats, ScanProgress } from '../types/library';
import { IpcService, isTauri } from '../services/ipc';
import { Storage } from '../services/storage';
import { useToast } from './ToastContext';
import { useSettings } from './SettingsContext';
import { t } from '../i18n';
import { normalizeLibraryTrack } from '../services/trackPresentation';

interface LibraryContextType {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  genres: Genre[];
  stats: LibraryStats;
  scanProgress: ScanProgress | null;
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  scanDirectory: (path?: string) => Promise<void>;
  reloadLibrary: () => Promise<void>;
  toggleFavoriteTrack: (trackId: string) => boolean;
  toggleFavoriteAlbum: (albumKey: string) => boolean;
  toggleFavoriteArtist: (artistName: string) => boolean;
  getTrackById: (id: string) => Track | undefined;
  favoriteTrackIds: Set<string>;
  favoriteAlbumKeys: Set<string>;
  favoriteArtistNames: Set<string>;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const GENRE_GRADIENTS = [
  'from-indigo-600 to-purple-800',
  'from-emerald-600 to-teal-800',
  'from-amber-600 to-orange-800',
  'from-rose-600 to-pink-800',
  'from-cyan-600 to-blue-800',
  'from-violet-600 to-fuchsia-800',
];

// SQLite owns favorites in the desktop build; localStorage remains the store
// for the browser/mock preview.
const useBackendFavorites = isTauri();
const FAVORITES_MIGRATED_KEY = 'nghenhac_favorites_migrated_v1';

function splitAlbumKey(albumKey: string): { albumTitle: string; artistName: string } {
  const sep = albumKey.indexOf('|||');
  if (sep === -1) return { albumTitle: albumKey, artistName: '' };
  return { albumTitle: albumKey.slice(0, sep), artistName: albumKey.slice(sep + 3) };
}

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { settings, addMusicFolder } = useSettings();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [stats, setStats] = useState<LibraryStats>({
    total_tracks: 0,
    total_artists: 0,
    total_albums: 0,
    total_duration_secs: 0,
  });
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<string>>(
    () => (useBackendFavorites ? new Set() : Storage.getFavoriteTrackIds())
  );
  const [favoriteAlbumKeys, setFavoriteAlbumKeys] = useState<Set<string>>(
    () => (useBackendFavorites ? new Set() : Storage.getFavoriteAlbums())
  );
  const [favoriteArtistNames, setFavoriteArtistNames] = useState<Set<string>>(
    () => (useBackendFavorites ? new Set() : Storage.getFavoriteArtists())
  );

  /** One-time push of legacy localStorage favorites into SQLite. */
  const migrateLocalFavorites = useCallback(async (loadedTracks: Track[]) => {
    if (!useBackendFavorites || localStorage.getItem(FAVORITES_MIGRATED_KEY)) return;
    localStorage.setItem(FAVORITES_MIGRATED_KEY, '1');

    const trackIds = Storage.getFavoriteTrackIds();
    const albumKeys = Storage.getFavoriteAlbums();
    const artistNames = Storage.getFavoriteArtists();
    const known = new Set(loadedTracks.map(track => track.id));

    try {
      for (const id of trackIds) {
        if (known.has(id)) {
          await IpcService.invoke('set_track_favorite', { id, isFavorite: true });
        }
      }
      for (const key of albumKeys) {
        const { albumTitle, artistName } = splitAlbumKey(key);
        await IpcService.invoke('set_album_favorite', { albumTitle, artistName, isFavorite: true });
      }
      for (const name of artistNames) {
        await IpcService.invoke('set_artist_favorite', { artistName: name, isFavorite: true });
      }
    } catch (err) {
      console.warn('Favorites migration failed', err);
    }
  }, []);

  const loadBackendFavorites = useCallback(async () => {
    if (!useBackendFavorites) return;
    try {
      const [favAlbums, favArtists] = await Promise.all([
        IpcService.invoke('get_favorite_albums'),
        IpcService.invoke('get_favorite_artists'),
      ]);
      setFavoriteAlbumKeys(new Set((favAlbums || []).map(a => `${a.album_title}|||${a.artist_name}`)));
      setFavoriteArtistNames(new Set(favArtists || []));
    } catch (err) {
      console.warn('Failed to load favorites from backend', err);
    }
  }, []);

  // Load Tracks & Library from IPC on mount
  const reloadLibrary = useCallback(async () => {
    try {
      setIsLoading(true);
      const [fetchedTracks, fetchedStats] = await Promise.all([
        IpcService.invoke('get_all_tracks'),
        IpcService.invoke('get_library_stats'),
      ]);

      const normalized = (fetchedTracks || []).map(normalizeLibraryTrack);

      if (useBackendFavorites) {
        await migrateLocalFavorites(normalized);
        // is_favorite comes straight from SQLite.
        setTracks(normalized);
        setFavoriteTrackIds(new Set(normalized.filter(track => track.is_favorite).map(track => track.id)));
        await loadBackendFavorites();
      } else {
        const favTracks = Storage.getFavoriteTrackIds();
        setTracks(normalized.map(track => ({ ...track, is_favorite: favTracks.has(track.id) })));
        setFavoriteTrackIds(favTracks);
      }

      if (fetchedStats) setStats(fetchedStats);
    } catch (err) {
      console.error('Failed to load library data', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadBackendFavorites, migrateLocalFavorites]);

  useEffect(() => {
    reloadLibrary();

    // Listen for scanning progress events
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;

    (async () => {
      unlistenProgress = await IpcService.listen('library://scan_progress', (progress) => {
        setScanProgress(progress);
      });
      unlistenFinished = await IpcService.listen('library://scan_finished', () => {
        setScanProgress(null);
        reloadLibrary();
      });
    })();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenFinished) unlistenFinished();
    };
  }, [reloadLibrary]);

  // Derived: Albums
  const albums = useMemo<Album[]>(() => {
    const albumMap = new Map<string, Album>();

    for (const track of tracks) {
      const key = `${track.album}|||${track.artist}`;
      let album = albumMap.get(key);
      if (!album) {
        album = {
          id: key,
          name: track.album || 'Unknown Album',
          artist: track.artist || 'Unknown Artist',
          year: track.year,
          genre: track.genre,
          track_count: 0,
          total_duration: 0,
          tracks: [],
        };
        albumMap.set(key, album);
      }
      album.track_count++;
      album.total_duration += track.duration || 0;
      album.tracks.push(track);
    }

    // Sort tracks in each album by track_number
    for (const album of albumMap.values()) {
      album.tracks.sort((a, b) => (a.track_number || 99) - (b.track_number || 99));
    }

    return Array.from(albumMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);

  // Derived: Artists
  const artists = useMemo<Artist[]>(() => {
    const artistMap = new Map<string, Artist>();

    for (const album of albums) {
      let artist = artistMap.get(album.artist);
      if (!artist) {
        artist = {
          id: album.artist,
          name: album.artist,
          track_count: 0,
          album_count: 0,
          albums: [],
          genres: [],
        };
        artistMap.set(album.artist, artist);
      }
      artist.album_count++;
      artist.track_count += album.track_count;
      artist.albums.push(album);
      if (album.genre && !artist.genres.includes(album.genre)) {
        artist.genres.push(album.genre);
      }
    }

    return Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [albums]);

  // Derived: Genres
  const genres = useMemo<Genre[]>(() => {
    const genreMap = new Map<string, { count: number; duration: number }>();

    for (const track of tracks) {
      const gName = track.genre || 'Other';
      const existing = genreMap.get(gName) || { count: 0, duration: 0 };
      existing.count++;
      existing.duration += track.duration || 0;
      genreMap.set(gName, existing);
    }

    return Array.from(genreMap.entries()).map(([name, data], idx) => ({
      name,
      track_count: data.count,
      total_duration: data.duration,
      color_gradient: GENRE_GRADIENTS[idx % GENRE_GRADIENTS.length],
    })).sort((a, b) => b.track_count - a.track_count);
  }, [tracks]);

  const scanDirectory = useCallback(async (path?: string) => {
    let targetPath = path;
    if (!targetPath) {
      const picked = await IpcService.invoke('open_folder_dialog');
      if (!picked) return;
      targetPath = picked;
    }

    await IpcService.invoke('add_library_root', {
      path: targetPath,
      name: targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath,
    });
    addMusicFolder(targetPath);
    setScanProgress({
      total_files: 0,
      scanned_files: 0,
      current_path: targetPath,
      is_scanning: true,
    });

    try {
      const scannedTracks = await IpcService.invoke('scan_directory', { path: targetPath });
      if (scannedTracks) {
        setTracks(scannedTracks.map(normalizeLibraryTrack));
        showToast(t('settings_btn_rescan', settings.language), 'success');
      }
    } catch (e) {
      console.error('Scan error', e);
      showToast('Scan failed', 'error');
    } finally {
      setScanProgress(null);
    }
  }, [addMusicFolder, settings.language, showToast]);

  const toggleFavoriteTrack = useCallback((trackId: string): boolean => {
    let isFav: boolean;
    if (useBackendFavorites) {
      isFav = !favoriteTrackIds.has(trackId);
      void IpcService.invoke('set_track_favorite', { id: trackId, isFavorite: isFav }).catch(err =>
        console.warn('set_track_favorite failed', err)
      );
      setFavoriteTrackIds(prev => {
        const nextSet = new Set(prev);
        if (isFav) nextSet.add(trackId);
        else nextSet.delete(trackId);
        return nextSet;
      });
    } else {
      isFav = Storage.toggleFavoriteTrack(trackId);
      setFavoriteTrackIds(Storage.getFavoriteTrackIds());
    }
    setTracks(prev =>
      prev.map(track => (track.id === trackId ? { ...track, is_favorite: isFav } : track))
    );
    return isFav;
  }, [favoriteTrackIds]);

  const toggleFavoriteAlbum = useCallback((albumKey: string): boolean => {
    let isFav: boolean;
    if (useBackendFavorites) {
      isFav = !favoriteAlbumKeys.has(albumKey);
      const { albumTitle, artistName } = splitAlbumKey(albumKey);
      void IpcService.invoke('set_album_favorite', { albumTitle, artistName, isFavorite: isFav }).catch(
        err => console.warn('set_album_favorite failed', err)
      );
      setFavoriteAlbumKeys(prev => {
        const nextSet = new Set(prev);
        if (isFav) nextSet.add(albumKey);
        else nextSet.delete(albumKey);
        return nextSet;
      });
    } else {
      isFav = Storage.toggleFavoriteAlbum(albumKey);
      setFavoriteAlbumKeys(Storage.getFavoriteAlbums());
    }
    return isFav;
  }, [favoriteAlbumKeys]);

  const toggleFavoriteArtist = useCallback((artistName: string): boolean => {
    let isFav: boolean;
    if (useBackendFavorites) {
      isFav = !favoriteArtistNames.has(artistName);
      void IpcService.invoke('set_artist_favorite', { artistName, isFavorite: isFav }).catch(err =>
        console.warn('set_artist_favorite failed', err)
      );
      setFavoriteArtistNames(prev => {
        const nextSet = new Set(prev);
        if (isFav) nextSet.add(artistName);
        else nextSet.delete(artistName);
        return nextSet;
      });
    } else {
      isFav = Storage.toggleFavoriteArtist(artistName);
      setFavoriteArtistNames(Storage.getFavoriteArtists());
    }
    return isFav;
  }, [favoriteArtistNames]);

  const getTrackById = useCallback(
    (id: string): Track | undefined => tracks.find(track => track.id === id),
    [tracks]
  );

  const contextValue = useMemo<LibraryContextType>(
    () => ({
      tracks,
      albums,
      artists,
      genres,
      stats,
      scanProgress,
      isLoading,
      searchQuery,
      setSearchQuery,
      scanDirectory,
      reloadLibrary,
      toggleFavoriteTrack,
      toggleFavoriteAlbum,
      toggleFavoriteArtist,
      getTrackById,
      favoriteTrackIds,
      favoriteAlbumKeys,
      favoriteArtistNames,
    }),
    [
      tracks,
      albums,
      artists,
      genres,
      stats,
      scanProgress,
      isLoading,
      searchQuery,
      scanDirectory,
      reloadLibrary,
      toggleFavoriteTrack,
      toggleFavoriteAlbum,
      toggleFavoriteArtist,
      getTrackById,
      favoriteTrackIds,
      favoriteAlbumKeys,
      favoriteArtistNames,
    ]
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
    </LibraryContext.Provider>
  );
};

export function useLibrary(): LibraryContextType {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within LibraryProvider');
  }
  return context;
}

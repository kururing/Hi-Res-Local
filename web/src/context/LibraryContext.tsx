import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { Track, Album, Artist, Genre, LibraryStats, ScanProgress } from '../types/library';
import { IpcService } from '../services/ipc';
import { Storage } from '../services/storage';
import { useToast } from './ToastContext';
import { useSettings } from './SettingsContext';
import { t } from '../i18n';

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
  setTrackRating: (trackId: string, rating: number) => void;
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

  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<string>>(() => Storage.getFavoriteTrackIds());
  const [favoriteAlbumKeys, setFavoriteAlbumKeys] = useState<Set<string>>(() => Storage.getFavoriteAlbums());
  const [favoriteArtistNames, setFavoriteArtistNames] = useState<Set<string>>(() => Storage.getFavoriteArtists());


  // Load Tracks & Library from IPC on mount
  const reloadLibrary = useCallback(async () => {
    try {
      setIsLoading(true);
      const [fetchedTracks, fetchedStats] = await Promise.all([
        IpcService.invoke('get_all_tracks'),
        IpcService.invoke('get_library_stats'),
      ]);

      const favTracks = Storage.getFavoriteTrackIds();
      const currentRatings = Storage.getRatings();

      const mergedTracks = (fetchedTracks || []).map(tr => ({
        ...tr,
        is_favorite: favTracks.has(tr.id),
        rating: currentRatings[tr.id] ?? tr.rating ?? 0,
      }));

      setTracks(mergedTracks);
      if (fetchedStats) setStats(fetchedStats);
    } catch (err) {
      console.error('Failed to load library data', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const scanDirectory = async (path?: string) => {
    let targetPath = path;
    if (!targetPath) {
      const picked = await IpcService.invoke('open_folder_dialog');
      if (!picked) return;
      targetPath = picked;
    }

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
        setTracks(scannedTracks);
        showToast(t('settings_btn_rescan', settings.language), 'success');
      }
    } catch (e) {
      console.error('Scan error', e);
      showToast('Scan failed', 'error');
    } finally {
      setScanProgress(null);
    }
  };

  const toggleFavoriteTrack = (trackId: string): boolean => {
    const isFav = Storage.toggleFavoriteTrack(trackId);
    setFavoriteTrackIds(Storage.getFavoriteTrackIds());
    setTracks(prev =>
      prev.map(t => (t.id === trackId ? { ...t, is_favorite: isFav } : t))
    );
    return isFav;
  };

  const toggleFavoriteAlbum = (albumKey: string): boolean => {
    const isFav = Storage.toggleFavoriteAlbum(albumKey);
    setFavoriteAlbumKeys(Storage.getFavoriteAlbums());
    return isFav;
  };

  const toggleFavoriteArtist = (artistName: string): boolean => {
    const isFav = Storage.toggleFavoriteArtist(artistName);
    setFavoriteArtistNames(Storage.getFavoriteArtists());
    return isFav;
  };

  const setTrackRating = (trackId: string, rating: number) => {
    Storage.setRating(trackId, rating);
    setTracks(prev =>
      prev.map(t => (t.id === trackId ? { ...t, rating } : t))
    );
  };

  const getTrackById = (id: string): Track | undefined => {
    return tracks.find(t => t.id === id);
  };

  return (
    <LibraryContext.Provider
      value={{
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
        setTrackRating,
        getTrackById,
        favoriteTrackIds,
        favoriteAlbumKeys,
        favoriteArtistNames,
      }}
    >
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

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Playlist } from '../types/playlist';
import { Track } from '../types/library';
import { IpcService } from '../services/ipc';
import { parseM3u, generateM3u } from '../services/m3u';
import { useToast } from './ToastContext';
import { useLibrary } from './LibraryContext';
import { t } from '../i18n';
import { useSettings } from './SettingsContext';

interface PlaylistContextType {
  playlists: Playlist[];
  createPlaylist: (name: string, description?: string) => Promise<Playlist>;
  updatePlaylist: (id: string, partial: Partial<Playlist>) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
  getPlaylistTracks: (playlist: Playlist) => Track[];
  importM3uFile: (content: string, fallbackName?: string) => Promise<Playlist | null>;
  exportM3uFile: (playlistId: string) => string | null;
}

const PlaylistContext = createContext<PlaylistContextType | undefined>(undefined);

export const PlaylistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const { showToast } = useToast();
  const { tracks, getTrackById } = useLibrary();
  const { settings } = useSettings();

  const loadPlaylists = useCallback(async () => {
    try {
      const list = await IpcService.invoke('get_playlists');
      if (list) {
        setPlaylists(list);
      }
    } catch (e) {
      console.error('Failed to load playlists', e);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const createPlaylist = async (name: string, description?: string): Promise<Playlist> => {
    const pl = await IpcService.invoke('create_playlist', { name, description });
    setPlaylists(prev => [...prev, pl]);
    showToast(t('toast_playlist_created', settings.language, { name }), 'success');
    return pl;
  };

  const updatePlaylist = async (id: string, partial: Partial<Playlist>) => {
    await IpcService.invoke('update_playlist', {
      id,
      name: partial.name,
      description: partial.description ?? undefined,
      track_ids: partial.track_ids,
    });
    setPlaylists(prev =>
      prev.map(p => (p.id === id ? { ...p, ...partial, updated_at: new Date().toISOString() } : p))
    );
  };

  const deletePlaylist = async (id: string) => {
    await IpcService.invoke('delete_playlist', { id });
    setPlaylists(prev => prev.filter(p => p.id !== id));
    showToast(t('toast_playlist_deleted', settings.language), 'info');
  };

  const addTrackToPlaylist = async (playlistId: string, trackId: string) => {
    await IpcService.invoke('add_track_to_playlist', { playlist_id: playlistId, track_id: trackId });
    setPlaylists(prev =>
      prev.map(p => {
        if (p.id === playlistId && !p.track_ids.includes(trackId)) {
          return { ...p, track_ids: [...p.track_ids, trackId], updated_at: new Date().toISOString() };
        }
        return p;
      })
    );
    showToast(t('toast_track_added_to_playlist', settings.language), 'success');
  };

  const removeTrackFromPlaylist = async (playlistId: string, trackId: string) => {
    await IpcService.invoke('remove_track_from_playlist', { playlist_id: playlistId, track_id: trackId });
    setPlaylists(prev =>
      prev.map(p => {
        if (p.id === playlistId) {
          return { ...p, track_ids: p.track_ids.filter(id => id !== trackId), updated_at: new Date().toISOString() };
        }
        return p;
      })
    );
    showToast(t('toast_track_removed_from_playlist', settings.language), 'info');
  };

  const reorderPlaylist = async (playlistId: string, fromIndex: number, toIndex: number) => {
    const target = playlists.find(p => p.id === playlistId);
    if (!target) return;

    const newTrackIds = [...target.track_ids];
    const [moved] = newTrackIds.splice(fromIndex, 1);
    newTrackIds.splice(toIndex, 0, moved);

    await updatePlaylist(playlistId, { track_ids: newTrackIds });
  };

  const getPlaylistTracks = (playlist: Playlist): Track[] => {
    if (playlist.is_smart && playlist.smart_rule) {
      const rule = playlist.smart_rule;
      if (rule.type === 'rating_gte') {
        const minRating = Number(rule.value || 4);
        return tracks.filter(t => (t.rating || 0) >= minRating);
      }
      if (rule.type === 'genre') {
        const targetGenre = String(rule.value || '').toLowerCase();
        return tracks.filter(t => (t.genre || '').toLowerCase().includes(targetGenre));
      }
      if (rule.type === 'recently_added') {
        return [...tracks].sort((a, b) => new Date(b.date_added).getTime() - new Date(a.date_added).getTime()).slice(0, rule.limit || 20);
      }
      if (rule.type === 'top_played') {
        return [...tracks].sort((a, b) => (b.play_count || 0) - (a.play_count || 0)).slice(0, rule.limit || 20);
      }
      if (rule.type === 'hi_res') {
        return tracks.filter(t => (t.sample_rate || 0) >= 88200 || (t.bits_per_sample || 0) >= 24);
      }
    }

    return playlist.track_ids
      .map(id => getTrackById(id))
      .filter((t): t is Track => t !== undefined);
  };

  const importM3uFile = async (content: string, fallbackName = 'Imported Playlist'): Promise<Playlist | null> => {
    const entries = parseM3u(content);
    if (entries.length === 0) return null;

    // Match parsed entries with existing tracks in library by path or title+artist
    const matchedTrackIds: string[] = [];
    for (const entry of entries) {
      const byPath = tracks.find(t => t.path.toLowerCase() === entry.path.toLowerCase());
      if (byPath) {
        matchedTrackIds.push(byPath.id);
        continue;
      }
      if (entry.title) {
        const byTitle = tracks.find(t =>
          t.title.toLowerCase() === entry.title!.toLowerCase() &&
          (!entry.artist || t.artist.toLowerCase() === entry.artist.toLowerCase())
        );
        if (byTitle) {
          matchedTrackIds.push(byTitle.id);
        }
      }
    }

    const newPlaylist = await createPlaylist(fallbackName, `Imported M3U (${matchedTrackIds.length} tracks matched)`);
    await updatePlaylist(newPlaylist.id, { track_ids: matchedTrackIds });
    return newPlaylist;
  };

  const exportM3uFile = (playlistId: string): string | null => {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return null;
    const plTracks = getPlaylistTracks(pl);
    return generateM3u(pl, plTracks);
  };

  return (
    <PlaylistContext.Provider
      value={{
        playlists,
        createPlaylist,
        updatePlaylist,
        deletePlaylist,
        addTrackToPlaylist,
        removeTrackFromPlaylist,
        reorderPlaylist,
        getPlaylistTracks,
        importM3uFile,
        exportM3uFile,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
};

export function usePlaylists(): PlaylistContextType {
  const context = useContext(PlaylistContext);
  if (!context) {
    throw new Error('usePlaylists must be used within PlaylistProvider');
  }
  return context;
}

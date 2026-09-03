import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Playlist } from '../types/playlist';
import { Track } from '../types/library';
import { BackendPlaylist } from '../types/ipc';
import { parseM3u, generateM3u } from '../services/m3u';
import { useToast } from './ToastContext';
import { useLibrary } from './LibraryContext';
import { t } from '../i18n';
import { useSettings } from './SettingsContext';
import { PlatformUnsupportedError, usePlatform } from '../platform';
import { cloudTrackIdOf } from '../platform/hybrid/mergeLibrary';
import { useAuth } from './AuthContext';

function mapBackendPlaylist(pl: BackendPlaylist, trackIds: string[] = []): Playlist {
  return {
    id: pl.id,
    name: pl.name,
    description: pl.description ?? null,
    track_ids: trackIds,
    created_at: pl.created_at,
    updated_at: pl.updated_at,
    is_smart: pl.is_smart,
    cover_url: pl.cover_art_path ?? null,
  };
}

interface PlaylistContextType {
  playlists: Playlist[];
  createPlaylist: (name: string, description?: string) => Promise<Playlist>;
  updatePlaylist: (id: string, partial: Partial<Playlist>) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, trackId: string, notify?: boolean) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
  changePlaylistCover: (playlistId: string) => Promise<void>;
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
  const { playlists: playlistApi } = usePlatform();
  const { status: authStatus } = useAuth();

  const catalogTrackId = useCallback((trackId: string): string | null => {
    const track = getTrackById(trackId);
    if (!track) return trackId;
    return cloudTrackIdOf(track);
  }, [getTrackById]);

  const loadPlaylists = useCallback(async () => {
    try {
      const list = await playlistApi.list();
      if (!list) return;
      // Track membership lives in the backend join table; fetch it per playlist.
      const mapped = await Promise.all(
        list.map(async pl => {
          try {
            const detail = await playlistApi.get(pl.id);
            return mapBackendPlaylist(pl, (detail?.tracks || []).map(track => track.id));
          } catch {
            return mapBackendPlaylist(pl);
          }
        })
      );
      return mapped;
    } catch (e) {
      console.error('Failed to load playlists', e);
      return undefined;
    }
  }, [playlistApi]);

  useEffect(() => {
    let cancelled = false;
    void loadPlaylists().then(mapped => {
      if (!cancelled && mapped) setPlaylists(mapped);
    });
    return () => {
      cancelled = true;
    };
  }, [authStatus, loadPlaylists]);

  const createPlaylist = async (name: string, description?: string): Promise<Playlist> => {
    const created = await playlistApi.create({ name, description: description ?? null });
    const pl = mapBackendPlaylist(created);
    setPlaylists(prev => [...prev, pl]);
    showToast(t('toast_playlist_created', settings.language, { name }), 'success');
    return pl;
  };

  const updatePlaylist = async (id: string, partial: Partial<Playlist>) => {
    if (partial.name !== undefined || partial.description !== undefined || partial.cover_url !== undefined) {
      await playlistApi.update({
        id,
        name: partial.name ?? null,
        description: partial.description ?? null,
        cover_art_path: partial.cover_url ?? null,
      });
    }

    // Membership/order changes go through the dedicated backend commands.
    if (partial.track_ids) {
      const current = playlists.find(p => p.id === id);
      const oldIds = current?.track_ids ?? [];
      const newIds = partial.track_ids;
      const oldCatalog = oldIds.map(id => catalogTrackId(id) ?? id);
      const newCatalog = newIds.map(id => catalogTrackId(id)).filter((id): id is string => Boolean(id));
      const oldSet = new Set(oldCatalog);
      const newSet = new Set(newCatalog);
      const added = newCatalog.filter(id => !oldSet.has(id));
      const removed = oldCatalog.filter(id => !newSet.has(id));

      if (removed.length > 0) {
        await playlistApi.removeTracks(id, removed);
      }
      if (added.length > 0) {
        await playlistApi.addTracks(id, added);
      }
      await playlistApi.reorderTracks(id, newCatalog);
    }

    setPlaylists(prev =>
      prev.map(p => (p.id === id ? { ...p, ...partial, updated_at: new Date().toISOString() } : p))
    );
  };

  const deletePlaylist = async (id: string) => {
    await playlistApi.delete(id);
    setPlaylists(prev => prev.filter(p => p.id !== id));
    showToast(t('toast_playlist_deleted', settings.language), 'info');
  };

  const addTrackToPlaylist = async (playlistId: string, trackId: string, notify = true) => {
    const catalogId = catalogTrackId(trackId);
    if (!catalogId) {
      showToast(t('account_guest_subtitle', settings.language), 'info');
      return;
    }
    await playlistApi.addTracks(playlistId, [catalogId]);
    setPlaylists(prev =>
      prev.map(p => {
        if (p.id === playlistId && !p.track_ids.includes(catalogId) && !p.track_ids.includes(trackId)) {
          return { ...p, track_ids: [...p.track_ids, catalogId], updated_at: new Date().toISOString() };
        }
        return p;
      })
    );
    if (notify) {
      showToast(t('toast_track_added_to_playlist', settings.language), 'success');
    }
  };

  const removeTrackFromPlaylist = async (playlistId: string, trackId: string) => {
    const catalogId = catalogTrackId(trackId) ?? trackId;
    await playlistApi.removeTracks(playlistId, [catalogId]);
    setPlaylists(prev =>
      prev.map(p => {
        if (p.id === playlistId) {
          return {
            ...p,
            track_ids: p.track_ids.filter(id => id !== trackId && id !== catalogId),
            updated_at: new Date().toISOString(),
          };
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

  const changePlaylistCover = async (playlistId: string) => {
    if (!playlistApi.pickCover) return;
    try {
      const selection = await playlistApi.pickCover();
      if (!selection) return;
      await updatePlaylist(playlistId, { cover_url: selection.cover_art_path });
    } catch (error) {
      if (error instanceof PlatformUnsupportedError) return;
      throw error;
    }
  };

  const getPlaylistTracks = (playlist: Playlist): Track[] => {
    if (playlist.is_smart && playlist.smart_rule) {
      const rule = playlist.smart_rule;
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
        changePlaylistCover,
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

import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';
import { Playlist } from '../types/playlist';
import { EqualizerPreset } from '../types/audio';

const STORAGE_KEYS = {
  SETTINGS: 'nghenhac_settings_v2',
  FAVORITES_TRACKS: 'nghenhac_fav_tracks_v2',
  FAVORITES_ALBUMS: 'nghenhac_fav_albums_v2',
  FAVORITES_ARTISTS: 'nghenhac_fav_artists_v2',
  PLAYLISTS: 'nghenhac_playlists_v2',
  HISTORY: 'nghenhac_history_v2',
  EQ_PRESETS: 'nghenhac_eq_presets_v2',
  LAST_PLAYED_TRACK: 'nghenhac_last_track_v2',
  LAST_PLAYED_POSITION: 'nghenhac_last_pos_v2',
};

export interface HistoryItem {
  track_id: string;
  played_at: string;
  duration_played: number;
}

export const Storage = {
  getSettings(): AppSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!data) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(data) as Partial<AppSettings>;
      const settings = { ...DEFAULT_SETTINGS, ...parsed };
      if (settings.custom_image_theme && settings.custom_image_themes.length === 0) {
        const migrated = {
          ...settings.custom_image_theme,
          id: settings.custom_image_theme.id ?? 'legacy-image-theme',
          name: settings.custom_image_theme.name ?? 'Theme từ ảnh',
        };
        settings.custom_image_theme = migrated;
        settings.custom_image_themes = [migrated];
      }
      return settings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings to localStorage', e);
    }
  },

  getFavoriteTrackIds(): Set<string> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.FAVORITES_TRACKS);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  },

  toggleFavoriteTrack(trackId: string): boolean {
    const favs = this.getFavoriteTrackIds();
    let isFav = false;
    if (favs.has(trackId)) {
      favs.delete(trackId);
      isFav = false;
    } else {
      favs.add(trackId);
      isFav = true;
    }
    localStorage.setItem(STORAGE_KEYS.FAVORITES_TRACKS, JSON.stringify([...favs]));
    return isFav;
  },

  getFavoriteAlbums(): Set<string> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.FAVORITES_ALBUMS);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  },

  toggleFavoriteAlbum(albumKey: string): boolean {
    const favs = this.getFavoriteAlbums();
    const isFav = !favs.has(albumKey);
    if (favs.has(albumKey)) favs.delete(albumKey);
    else favs.add(albumKey);
    localStorage.setItem(STORAGE_KEYS.FAVORITES_ALBUMS, JSON.stringify([...favs]));
    return isFav;
  },

  getFavoriteArtists(): Set<string> {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.FAVORITES_ARTISTS);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  },

  toggleFavoriteArtist(artistName: string): boolean {
    const favs = this.getFavoriteArtists();
    const isFav = !favs.has(artistName);
    if (favs.has(artistName)) favs.delete(artistName);
    else favs.add(artistName);
    localStorage.setItem(STORAGE_KEYS.FAVORITES_ARTISTS, JSON.stringify([...favs]));
    return isFav;
  },

  getPlaylists(): Playlist[] | null {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  savePlaylists(playlists: Playlist[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    } catch (e) {
      console.error('Failed to save playlists', e);
    }
  },

  getHistory(): HistoryItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addHistory(trackId: string, durationPlayed: number): void {
    try {
      const history = this.getHistory();
      history.unshift({
        track_id: trackId,
        played_at: new Date().toISOString(),
        duration_played: Math.round(durationPlayed),
      });
      // Keep last 200 items
      const trimmed = history.slice(0, 200);
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to add history', e);
    }
  },

  getCustomEqPresets(): EqualizerPreset[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.EQ_PRESETS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveCustomEqPresets(presets: EqualizerPreset[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.EQ_PRESETS, JSON.stringify(presets));
    } catch (e) {
      console.error('Failed to save EQ presets', e);
    }
  },

  getLastPlayback(): { trackId: string | null; position: number } {
    return {
      trackId: localStorage.getItem(STORAGE_KEYS.LAST_PLAYED_TRACK),
      position: parseFloat(localStorage.getItem(STORAGE_KEYS.LAST_PLAYED_POSITION) || '0'),
    };
  },

  saveLastPlayback(trackId: string | null, position: number): void {
    if (trackId) {
      localStorage.setItem(STORAGE_KEYS.LAST_PLAYED_TRACK, trackId);
      localStorage.setItem(STORAGE_KEYS.LAST_PLAYED_POSITION, position.toString());
    }
  },

  exportBackup(): string {
    const backup = {
      version: '2.0.0',
      exported_at: new Date().toISOString(),
      settings: this.getSettings(),
      favorite_tracks: [...this.getFavoriteTrackIds()],
      favorite_albums: [...this.getFavoriteAlbums()],
      favorite_artists: [...this.getFavoriteArtists()],
      playlists: this.getPlaylists() || [],
      history: this.getHistory(),
      eq_presets: this.getCustomEqPresets(),
    };
    return JSON.stringify(backup, null, 2);
  },

  importBackup(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data.settings) this.saveSettings(data.settings);
      if (data.favorite_tracks) localStorage.setItem(STORAGE_KEYS.FAVORITES_TRACKS, JSON.stringify(data.favorite_tracks));
      if (data.favorite_albums) localStorage.setItem(STORAGE_KEYS.FAVORITES_ALBUMS, JSON.stringify(data.favorite_albums));
      if (data.favorite_artists) localStorage.setItem(STORAGE_KEYS.FAVORITES_ARTISTS, JSON.stringify(data.favorite_artists));
      if (data.playlists) this.savePlaylists(data.playlists);
      if (data.history) localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(data.history));
      if (data.eq_presets) this.saveCustomEqPresets(data.eq_presets);
      return true;
    } catch (e) {
      console.error('Backup import error', e);
      return false;
    }
  }
};

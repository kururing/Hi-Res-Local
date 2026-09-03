import { AppSettings, DEFAULT_SETTINGS, normalizeAudioSettings } from '../types/settings';
import { normalizeAppFont } from './fonts';
import { Playlist } from '../types/playlist';
import { EqualizerPreset } from '../types/audio';
import { LyricsMode } from '../types/lyrics';

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
  LAST_VOLUME: 'nghenhac_last_volume_v2',
  LAST_MUTED: 'nghenhac_last_muted_v2',
  LYRICS_MODE: 'nghenhac_lyrics_mode_v2',
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
      const settings = normalizeAudioSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
        font_family: normalizeAppFont(parsed.font_family),
        // Legacy payloads have no playback_mode; force the migration branch.
        playback_mode: (parsed.playback_mode ?? '') as AppSettings['playback_mode'],
      });
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

  setFavoriteTrack(trackId: string, favorite: boolean): void {
    const favs = this.getFavoriteTrackIds();
    if (favorite) favs.add(trackId);
    else favs.delete(trackId);
    localStorage.setItem(STORAGE_KEYS.FAVORITES_TRACKS, JSON.stringify([...favs]));
  },

  toggleFavoriteTrack(trackId: string): boolean {
    const isFav = !this.getFavoriteTrackIds().has(trackId);
    this.setFavoriteTrack(trackId, isFav);
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

  setFavoriteAlbum(albumKey: string, favorite: boolean): void {
    const favs = this.getFavoriteAlbums();
    if (favorite) favs.add(albumKey);
    else favs.delete(albumKey);
    localStorage.setItem(STORAGE_KEYS.FAVORITES_ALBUMS, JSON.stringify([...favs]));
  },

  toggleFavoriteAlbum(albumKey: string): boolean {
    const isFav = !this.getFavoriteAlbums().has(albumKey);
    this.setFavoriteAlbum(albumKey, isFav);
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

  setFavoriteArtist(artistName: string, favorite: boolean): void {
    const favs = this.getFavoriteArtists();
    if (favorite) favs.add(artistName);
    else favs.delete(artistName);
    localStorage.setItem(STORAGE_KEYS.FAVORITES_ARTISTS, JSON.stringify([...favs]));
  },

  toggleFavoriteArtist(artistName: string): boolean {
    const isFav = !this.getFavoriteArtists().has(artistName);
    this.setFavoriteArtist(artistName, isFav);
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

  clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
    } catch (e) {
      console.error('Failed to clear history', e);
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
    try {
      const position = Number(localStorage.getItem(STORAGE_KEYS.LAST_PLAYED_POSITION) || '0');
      return {
        trackId: localStorage.getItem(STORAGE_KEYS.LAST_PLAYED_TRACK),
        position: Number.isFinite(position) && position >= 0 ? position : 0,
      };
    } catch {
      return { trackId: null, position: 0 };
    }
  },

  saveLastPlayback(trackId: string | null, position: number): void {
    try {
      if (trackId) {
        const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
        localStorage.setItem(STORAGE_KEYS.LAST_PLAYED_TRACK, trackId);
        localStorage.setItem(STORAGE_KEYS.LAST_PLAYED_POSITION, safePosition.toString());
      }
    } catch (error) {
      console.warn('Failed to save local playback fallback', error);
    }
  },

  getAudioState(): { volume: number; isMuted: boolean } {
    const rawVolume = localStorage.getItem(STORAGE_KEYS.LAST_VOLUME);
    const savedVolume = rawVolume === null ? Number.NaN : Number(rawVolume);
    return {
      volume: Number.isFinite(savedVolume)
        ? Math.max(0, Math.min(1, savedVolume))
        : 0.85,
      isMuted: localStorage.getItem(STORAGE_KEYS.LAST_MUTED) === 'true',
    };
  },

  saveAudioState(volume: number, isMuted: boolean): void {
    const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.85;
    localStorage.setItem(STORAGE_KEYS.LAST_VOLUME, safeVolume.toString());
    localStorage.setItem(STORAGE_KEYS.LAST_MUTED, isMuted.toString());
  },

  getLyricsMode(): LyricsMode {
    const savedMode = localStorage.getItem(STORAGE_KEYS.LYRICS_MODE);
    return savedMode === 'original' || savedMode === 'romanized' || savedMode === 'both'
      ? savedMode
      : 'both';
  },

  saveLyricsMode(mode: LyricsMode): void {
    localStorage.setItem(STORAGE_KEYS.LYRICS_MODE, mode);
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
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      if (data.version !== '2.0.0') return false;
      if (data.settings !== undefined && (typeof data.settings !== 'object' || Array.isArray(data.settings))) return false;
      for (const key of ['favorite_tracks', 'favorite_albums', 'favorite_artists', 'playlists', 'history', 'eq_presets']) {
        if (data[key] !== undefined && !Array.isArray(data[key])) return false;
      }
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

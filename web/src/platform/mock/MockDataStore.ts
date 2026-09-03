import { MOCK_OUTPUT_DEVICES, MOCK_PLAYLISTS, MOCK_TRACKS, SAMPLE_LRC_ROMANIZED, getMockStats } from '../../services/mock';
import { Storage, type HistoryItem } from '../../services/storage';
import type { AudioOutputDevice } from '../../types/audio';
import type { BackendPlaylist, FavoriteAlbum, LibraryRoot, PlayHistoryEntry } from '../../types/ipc';
import type { LibraryStats, Track } from '../../types/library';
import type { Playlist } from '../../types/playlist';

const TRACK_13_ID = 'track-13';
const ALBUM_KEY_SEP = '|||';

export interface MockDataStoreOptions {
  /** Persist playlists/favorites/history to localStorage like Vite preview. */
  persist?: boolean;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function albumKey(albumTitle: string, artistName: string): string {
  return `${albumTitle}${ALBUM_KEY_SEP}${artistName}`;
}

function parseAlbumKey(key: string): FavoriteAlbum {
  const sep = key.indexOf(ALBUM_KEY_SEP);
  if (sep === -1) return { album_title: key, artist_name: '' };
  return { album_title: key.slice(0, sep), artist_name: key.slice(sep + 3) };
}

function clonePlaylist(playlist: Playlist): Playlist {
  return {
    ...playlist,
    track_ids: [...playlist.track_ids],
  };
}

function cloneTrack(track: Track): Track {
  return { ...track };
}

/**
 * Single in-memory owner of mock library, playlist, favorite, history, and
 * preference state. Domain Mock APIs must share one store per runtime.
 */
export class MockDataStore {
  private tracks: Track[] = [];
  private playlists: Playlist[] = [];
  private libraryRoots: LibraryRoot[] = [];
  private favoriteTrackIds = new Set<string>();
  private favoriteAlbums = new Set<string>();
  private favoriteArtists = new Set<string>();
  private history: HistoryItem[] = [];
  private romanizedLyrics = new Map<string, string>();
  private outputDevices: AudioOutputDevice[] = [];
  private autostartEnabled = false;
  private readonly persist: boolean;

  constructor(options: MockDataStoreOptions = {}) {
    this.persist = options.persist ?? false;
    this.resetFromFixtures();
    if (this.persist) this.hydrateFromStorage();
  }

  reset(): void {
    this.resetFromFixtures();
    if (this.persist) this.writeAllToStorage();
  }

  getTracks(): Track[] {
    return this.tracks.map(track => this.withFavoriteFlag(track));
  }

  getTrackById(id: string): Track | null {
    const track = this.tracks.find(item => item.id === id);
    return track ? this.withFavoriteFlag(track) : null;
  }

  getStats(): LibraryStats {
    return getMockStats(this.tracks);
  }

  getRoots(): LibraryRoot[] {
    return this.libraryRoots.map(root => ({ ...root }));
  }

  addRoot(path: string, name: string): LibraryRoot {
    const existing = this.libraryRoots.find(root => root.path === path);
    if (existing) return { ...existing };
    const root: LibraryRoot = {
      id: `root-${Date.now()}`,
      path,
      name,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    this.libraryRoots.push(root);
    return { ...root };
  }

  removeRoot(path: string): boolean {
    const before = this.libraryRoots.length;
    this.libraryRoots = this.libraryRoots.filter(root => root.path !== path);
    return before !== this.libraryRoots.length;
  }

  getPlaylists(): Playlist[] {
    return this.playlists.map(clonePlaylist);
  }

  getPlaylist(id: string): Playlist | null {
    const playlist = this.playlists.find(item => item.id === id);
    return playlist ? clonePlaylist(playlist) : null;
  }

  toBackendPlaylist(playlist: Playlist): BackendPlaylist {
    const tracks = playlist.track_ids
      .map(id => this.tracks.find(track => track.id === id))
      .filter((track): track is Track => Boolean(track));
    return {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description ?? null,
      is_smart: playlist.is_smart ?? false,
      rules_json: null,
      cover_art_path: playlist.cover_url ?? null,
      track_count: playlist.track_ids.length,
      total_duration_ms: tracks.reduce((sum, track) => sum + (track.duration || 0) * 1000, 0),
      created_at: playlist.created_at,
      updated_at: playlist.updated_at,
    };
  }

  getPlaylistTracks(playlist: Playlist): Track[] {
    return playlist.track_ids
      .map(id => this.getTrackById(id))
      .filter((track): track is Track => Boolean(track));
  }

  createPlaylist(input: { name: string; description?: string | null; is_smart?: boolean | null }): Playlist {
    const created: Playlist = {
      id: `pl-${Date.now()}`,
      name: input.name,
      description: input.description || '',
      track_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_smart: input.is_smart ?? false,
    };
    this.playlists.push(created);
    this.persistPlaylists();
    return clonePlaylist(created);
  }

  updatePlaylist(input: {
    id: string;
    name?: string | null;
    description?: string | null;
    cover_art_path?: string | null;
  }): Playlist {
    const index = this.playlists.findIndex(item => item.id === input.id);
    if (index === -1) throw new Error('Playlist not found');
    this.playlists[index] = {
      ...this.playlists[index],
      name: input.name ?? this.playlists[index].name,
      description: input.description ?? this.playlists[index].description,
      cover_url: input.cover_art_path ?? this.playlists[index].cover_url,
      updated_at: new Date().toISOString(),
    };
    this.persistPlaylists();
    return clonePlaylist(this.playlists[index]);
  }

  deletePlaylist(id: string): boolean {
    this.playlists = this.playlists.filter(item => item.id !== id);
    this.persistPlaylists();
    return true;
  }

  addTracksToPlaylist(playlistId: string, trackIds: string[]): number {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return 0;
    let added = 0;
    for (const trackId of trackIds) {
      if (!playlist.track_ids.includes(trackId)) {
        playlist.track_ids.push(trackId);
        added += 1;
      }
    }
    playlist.updated_at = new Date().toISOString();
    this.persistPlaylists();
    return added;
  }

  removeTracksFromPlaylist(playlistId: string, trackIds: string[]): number {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return 0;
    const removeSet = new Set(trackIds);
    const before = playlist.track_ids.length;
    playlist.track_ids = playlist.track_ids.filter(id => !removeSet.has(id));
    playlist.updated_at = new Date().toISOString();
    this.persistPlaylists();
    return before - playlist.track_ids.length;
  }

  reorderPlaylistTracks(playlistId: string, trackIds: string[]): void {
    const playlist = this.playlists.find(item => item.id === playlistId);
    if (!playlist) return;
    playlist.track_ids = [...trackIds];
    playlist.updated_at = new Date().toISOString();
    this.persistPlaylists();
  }

  setTrackFavorite(trackId: string, favorite: boolean): void {
    if (favorite) this.favoriteTrackIds.add(trackId);
    else this.favoriteTrackIds.delete(trackId);
    this.syncTrackFavoriteFlags();
    if (this.canUseStorage()) {
      Storage.setFavoriteTrack(trackId, favorite);
    }
  }

  setAlbumFavorite(albumTitle: string, artistName: string, favorite: boolean): void {
    const key = albumKey(albumTitle, artistName);
    if (favorite) this.favoriteAlbums.add(key);
    else this.favoriteAlbums.delete(key);
    if (this.canUseStorage()) {
      Storage.setFavoriteAlbum(key, favorite);
    }
  }

  setArtistFavorite(artistName: string, favorite: boolean): void {
    if (favorite) this.favoriteArtists.add(artistName);
    else this.favoriteArtists.delete(artistName);
    if (this.canUseStorage()) {
      Storage.setFavoriteArtist(artistName, favorite);
    }
  }

  getFavoriteAlbums(): FavoriteAlbum[] {
    return [...this.favoriteAlbums].map(parseAlbumKey);
  }

  getFavoriteArtists(): string[] {
    return [...this.favoriteArtists];
  }

  getFavoriteTrackIds(): string[] {
    return [...this.favoriteTrackIds];
  }

  recordPlay(input: {
    track_id: string;
    completed_duration_ms: number;
    fully_played: boolean;
  }): PlayHistoryEntry {
    const durationPlayed = input.completed_duration_ms / 1000;
    const playedAt = new Date().toISOString();
    this.history.unshift({
      track_id: input.track_id,
      played_at: playedAt,
      duration_played: Math.round(durationPlayed),
    });
    this.history = this.history.slice(0, 200);
    if (this.canUseStorage()) {
      Storage.addHistory(input.track_id, durationPlayed);
    }
    return {
      id: Date.now(),
      track_id: input.track_id,
      track: this.getTrackById(input.track_id),
      played_at: playedAt,
      completed_duration_ms: input.completed_duration_ms,
      fully_played: input.fully_played,
    };
  }

  listHistory(limit = 100, offset = 0): PlayHistoryEntry[] {
    return this.history.slice(offset, offset + limit).map((item, index) => ({
      id: offset + index + 1,
      track_id: item.track_id,
      track: this.getTrackById(item.track_id),
      played_at: item.played_at,
      completed_duration_ms: item.duration_played * 1000,
      fully_played: false,
    }));
  }

  clearHistory(): number {
    const count = this.history.length;
    this.history = [];
    if (this.canUseStorage()) {
      Storage.clearHistory();
    }
    return count;
  }

  getRomanizedLyrics(trackId: string): string | undefined {
    return this.romanizedLyrics.get(trackId);
  }

  getOutputDevices(): AudioOutputDevice[] {
    return this.outputDevices.map(device => ({
      ...device,
      sample_rates: device.sample_rates ? [...device.sample_rates] : undefined,
      bit_depths: device.bit_depths ? [...device.bit_depths] : undefined,
      channels: device.channels ? [...device.channels] : undefined,
      dsd_rates: device.dsd_rates ? [...device.dsd_rates] : undefined,
    }));
  }

  isAutostartEnabled(): boolean {
    return this.autostartEnabled;
  }

  setAutostartEnabled(enabled: boolean): void {
    this.autostartEnabled = enabled;
  }

  private withFavoriteFlag(track: Track): Track {
    return { ...cloneTrack(track), is_favorite: this.favoriteTrackIds.has(track.id) };
  }

  private syncTrackFavoriteFlags(): void {
    this.tracks = this.tracks.map(track => ({
      ...track,
      is_favorite: this.favoriteTrackIds.has(track.id),
    }));
  }

  private resetFromFixtures(): void {
    this.tracks = cloneValue(MOCK_TRACKS);
    this.playlists = cloneValue(MOCK_PLAYLISTS);
    this.libraryRoots = [];
    this.favoriteTrackIds = new Set(
      this.tracks.filter(track => track.is_favorite).map(track => track.id)
    );
    this.favoriteAlbums = new Set();
    this.favoriteArtists = new Set();
    this.history = [];
    this.romanizedLyrics = new Map<string, string>([
      [TRACK_13_ID, SAMPLE_LRC_ROMANIZED],
    ]);
    this.outputDevices = cloneValue(MOCK_OUTPUT_DEVICES);
    this.autostartEnabled = false;
    this.syncTrackFavoriteFlags();
  }

  private hydrateFromStorage(): void {
    if (!this.canUseStorage()) return;
    const storedPlaylists = Storage.getPlaylists();
    if (storedPlaylists) this.playlists = cloneValue(storedPlaylists);
    this.favoriteTrackIds = new Set(Storage.getFavoriteTrackIds());
    this.favoriteAlbums = new Set(Storage.getFavoriteAlbums());
    this.favoriteArtists = new Set(Storage.getFavoriteArtists());
    this.history = cloneValue(Storage.getHistory());
    this.syncTrackFavoriteFlags();
  }

  private canUseStorage(): boolean {
    return this.persist && typeof localStorage !== 'undefined';
  }

  private persistPlaylists(): void {
    if (!this.canUseStorage()) return;
    Storage.savePlaylists(this.playlists.map(clonePlaylist));
  }

  private writeAllToStorage(): void {
    if (!this.canUseStorage()) return;
    this.persistPlaylists();
    Storage.clearHistory();
    try {
      for (const id of Storage.getFavoriteTrackIds()) {
        if (!this.favoriteTrackIds.has(id)) Storage.setFavoriteTrack(id, false);
      }
      for (const id of this.favoriteTrackIds) Storage.setFavoriteTrack(id, true);
      for (const key of Storage.getFavoriteAlbums()) {
        if (!this.favoriteAlbums.has(key)) Storage.setFavoriteAlbum(key, false);
      }
      for (const key of this.favoriteAlbums) Storage.setFavoriteAlbum(key, true);
      for (const name of Storage.getFavoriteArtists()) {
        if (!this.favoriteArtists.has(name)) Storage.setFavoriteArtist(name, false);
      }
      for (const name of this.favoriteArtists) Storage.setFavoriteArtist(name, true);
    } catch {
      // Preview persistence is best-effort when localStorage is missing.
    }
  }
}

import type { CloudApiClient } from '../api/client';
import type { AccountApi } from '../auth/types';
import type { AdminCatalogApi } from './admin/contracts';
import type { AudioEngine } from '../audio/contracts';
import type {
  AsioDriver,
  AudioBackend,
  AudioCapabilities,
  AudioOutputDevice,
  DsdOutputMode,
  EngineStatus,
  PlaybackMode,
  ReplayGainMode,
} from '../types/audio';
import type { LibraryStats, ScanProgress, Track } from '../types/library';
import type { LyricData } from '../types/lyrics';
import type {
  BackendPlaylist,
  FavoriteAlbum,
  IpcCommands,
  IpcEvents,
  LibraryRoot,
  PlayHistoryEntry,
  PlaylistDetails,
} from '../types/ipc';

export type AppRuntime = 'tauri' | 'web' | 'mock';

export interface PlatformCapabilities {
  account: boolean;
  /** When true, AuthGate blocks the app until a session exists. Desktop is optional. */
  accountRequired: boolean;
  cloudApi: boolean;
  directoryScanning: boolean;
  localFileSystem: boolean;
  nativeAudio: boolean;
  nativeWindowChrome: boolean;
  remotePlayback: boolean;
  databaseBackup: boolean;
  themeImageCache: boolean;
  discordPresence: boolean;
  autostart: boolean;
  adminCatalog: boolean;
}

export type PlatformEventCallback<K extends keyof IpcEvents> = (
  payload: IpcEvents[K]
) => void;

/**
 * Temporary bridge for the existing command-oriented contexts. New feature
 * modules should depend on a domain API instead of adding more IPC commands.
 */
export interface PlatformCommandGateway {
  invoke<K extends keyof IpcCommands>(
    command: K,
    args?: IpcCommands[K]['args']
  ): Promise<IpcCommands[K]['return']>;

  listen<K extends keyof IpcEvents>(
    event: K,
    callback: PlatformEventCallback<K>
  ): Promise<() => void>;
}

export type LibraryScanFinished = IpcEvents['library://scan_finished'];

/**
 * Runtime-independent library contract. Desktop adapters talk to typed IPC;
 * the web adapter reads the published cloud catalog and rejects local
 * filesystem operations.
 */
export interface LibraryApi {
  getAllTracks(): Promise<Track[]>;
  getStats(): Promise<LibraryStats>;
  getRoots(): Promise<LibraryRoot[]>;
  pickFolder(): Promise<string | null>;
  addRoot(path: string, name: string): Promise<LibraryRoot>;
  removeRoot(path: string): Promise<boolean>;
  scanDirectory(path: string): Promise<Track[]>;
  scanLibrary(): Promise<number>;
  setDirectoryWatching(enabled: boolean): Promise<void>;
  subscribeScanProgress(callback: (progress: ScanProgress) => void): Promise<() => void>;
  subscribeScanFinished(callback: (result: LibraryScanFinished) => void): Promise<() => void>;
  subscribeTrackUpdated(callback: (track: Track) => void): Promise<() => void>;
  subscribeTrackDeleted(callback: (trackId: string) => void): Promise<() => void>;
}

export type CreatePlaylistInput = IpcCommands['create_playlist']['args']['input'];
export type UpdatePlaylistInput = IpcCommands['update_playlist']['args']['input'];

export interface PlaylistCoverSelection {
  cover_art_path: string;
}

export interface PlaylistApi {
  list(): Promise<BackendPlaylist[]>;
  get(id: string): Promise<PlaylistDetails>;
  create(input: CreatePlaylistInput): Promise<BackendPlaylist>;
  update(input: UpdatePlaylistInput): Promise<BackendPlaylist>;
  delete(id: string): Promise<boolean>;
  addTracks(playlistId: string, trackIds: string[]): Promise<number>;
  removeTracks(playlistId: string, trackIds: string[]): Promise<number>;
  reorderTracks(playlistId: string, trackIds: string[]): Promise<void>;
  pickCover?(): Promise<PlaylistCoverSelection | null>;
}

export interface FavoritesApi {
  setTrackFavorite(trackId: string, favorite: boolean): Promise<void>;
  setAlbumFavorite(
    albumTitle: string,
    artistName: string,
    favorite: boolean
  ): Promise<void>;
  setArtistFavorite(artistName: string, favorite: boolean): Promise<void>;
  getFavoriteAlbums(): Promise<FavoriteAlbum[]>;
  getFavoriteArtists(): Promise<string[]>;
}

export interface RecordPlayInput {
  track_id: string;
  completed_duration_ms: number;
  fully_played: boolean;
  /** Optional idempotency token for future cloud retries. Never sent over IPC. */
  client_request_id?: string;
}

export interface HistoryListOptions {
  limit?: number;
  offset?: number;
}

export interface HistoryApi {
  record(input: RecordPlayInput): Promise<PlayHistoryEntry>;
  list(options?: HistoryListOptions): Promise<PlayHistoryEntry[]>;
  clear(): Promise<number>;
}

export interface ApplyPlaybackModeInput {
  mode: PlaybackMode;
  deviceId?: string | null;
  backend?: AudioBackend | null;
  dsdTransport?: DsdOutputMode | null;
  asioDriverId?: string | null;
  mqaPassthrough?: boolean | null;
}

export interface ReplayGainInput {
  mode: ReplayGainMode;
  preamp_db: number;
  prevent_clipping: boolean;
}

export interface ExclusiveModeEvent {
  enabled: boolean;
  output_mode: string;
  error?: string | null;
}

export interface AudioConfigurationApi {
  getOutputDevices(): Promise<AudioOutputDevice[]>;
  requestOutputDevice?(): Promise<AudioOutputDevice | null>;
  getCapabilities(): Promise<AudioCapabilities>;
  getAsioDrivers(): Promise<AsioDriver[]>;

  setOutputDevice(deviceId: string): Promise<void>;
  applyPlaybackMode(input: ApplyPlaybackModeInput): Promise<EngineStatus | null>;

  setEqualizer(enabled: boolean, gains: number[]): Promise<void>;
  setCrossfade(durationSeconds: number): Promise<void>;
  setReplayGain(input: ReplayGainInput): Promise<void>;

  subscribeExclusiveMode(
    callback: (event: ExclusiveModeEvent) => void
  ): Promise<() => void>;

  getAudioTomlPatch?(): Promise<{
    audio_engine: string;
    bit_perfect: boolean;
    output_device: string;
    wasapi_exclusive: boolean;
    dsd_output_mode: string;
    eq_enabled: boolean;
    replay_gain_mode: string;
  } | null>;
}

export interface PlatformCloseRequest {
  preventDefault(): void;
}

export interface WindowApi {
  onCloseRequested(
    callback: (event: PlatformCloseRequest) => void | Promise<void>
  ): Promise<() => void>;

  subscribeResize(callback: () => void): Promise<() => void>;

  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  hide(): Promise<void>;
  quit(): Promise<void>;
}

export type ThemeImageCategory = 'remote-artwork' | 'themes';

export interface CacheThemeImageInput {
  cacheKey: string;
  category: ThemeImageCategory;
  dataUrl: string;
}

export interface ThemeAssetsApi {
  cacheImage(input: CacheThemeImageInput): Promise<string>;
}

export interface ArtworkAssetsApi {
  resolveDisplaySource(source: string | null | undefined): Promise<string | null>;

  getAppleMusicArtistArtwork(
    country: string,
    artistId: number,
  ): Promise<string | null>;

  cacheRemoteArtwork(
    cacheKey: string,
    dataUrl: string,
  ): Promise<string>;

  clearRemoteArtworkCache(): Promise<void>;
}

export class ArtworkCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtworkCacheError';
  }
}

export interface BackupApi {
  exportDatabase(): Promise<number[]>;
  importDatabase(data: number[]): Promise<void>;
}

export interface PresenceActivity {
  title: string;
  artist: string;
  artwork_url?: string | null;
  position_secs: number;
  duration_secs: number;
}

export interface PresenceApi {
  setDiscordPresence(
    enabled: boolean,
    activity: PresenceActivity | null
  ): Promise<void>;
}

export interface AutostartApi {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
}

/**
 * Domain lyrics payload. Line timestamps are seconds from the start of the track.
 * `instrumental` is set when a provider reports an instrumental recording.
 */
export type TrackLyrics = LyricData;

export interface RemoteLyricsRequest {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  /** Track duration in seconds. Cloud resolve uses this; Tauri looks the track up by id. */
  durationSeconds: number;
  genre?: string | null;
}

export interface LyricsApi {
  /** Local or library-synced lyrics. `null` means the track has no stored lyrics. */
  getTrackLyrics(trackId: string): Promise<TrackLyrics | null>;

  /**
   * Provider lookup (LRCLIB on desktop, cloud resolve on web).
   * `null` means not found. Auth, network, and server errors throw.
   */
  fetchRemoteLyrics(request: RemoteLyricsRequest): Promise<TrackLyrics | null>;
}

export interface PlatformApi {
  runtime: AppRuntime;
  capabilities: PlatformCapabilities;
  commands: PlatformCommandGateway;
  library: LibraryApi;
  playlists: PlaylistApi;
  favorites: FavoritesApi;
  history: HistoryApi;
  lyrics: LyricsApi;
  audioConfiguration: AudioConfigurationApi;
  audioEngine: AudioEngine;
  presence: PresenceApi;
  window: WindowApi;
  themeAssets: ThemeAssetsApi;
  artworkAssets: ArtworkAssetsApi;
  backup: BackupApi;
  autostart: AutostartApi;
  account: AccountApi | null;
  cloud: CloudApiClient | null;
  admin: AdminCatalogApi | null;
}

export class PlatformUnsupportedError extends Error {
  constructor(runtime: AppRuntime, operation: string) {
    super(`Operation "${operation}" is not available in the ${runtime} runtime.`);
    this.name = 'PlatformUnsupportedError';
  }
}

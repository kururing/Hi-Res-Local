import { normalizeLyricsData } from '../../services/lrc';
import type {
  LyricsApi,
  PlatformCommandGateway,
  RemoteLyricsRequest,
  TrackLyrics,
} from '../contracts';

/** Raw Tauri lyrics payload. Line times may be seconds or `timestamp_ms`. */
interface IpcLyricLinePayload {
  timestamp?: number;
  timestamp_ms?: number;
  text?: string;
  romanized?: string;
  translation?: string;
}

interface IpcLyricsPayload {
  is_synced?: boolean;
  lines?: IpcLyricLinePayload[];
  plain_text?: string;
  source?: string;
  romanized?: IpcLyricsPayload;
  instrumental?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  offset?: number;
}

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);
  return new Error(fallback);
}

function normalizeIpcLyrics(raw: IpcLyricsPayload | null | undefined): TrackLyrics | null {
  if (raw == null) return null;
  return normalizeLyricsData(raw);
}

/** IPC-backed lyrics adapter for the Tauri desktop runtime. */
export class IpcLyricsApi implements LyricsApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  async getTrackLyrics(trackId: string): Promise<TrackLyrics | null> {
    try {
      const payload = await this.commands.invoke('get_track_lyrics', { trackId }) as IpcLyricsPayload | null;
      return normalizeIpcLyrics(payload);
    } catch (error) {
      throw asError(error, `get_track_lyrics failed for track "${trackId}"`);
    }
  }

  async fetchRemoteLyrics(request: RemoteLyricsRequest): Promise<TrackLyrics | null> {
    try {
      const payload = await this.commands.invoke('fetch_lrclib_lyrics', {
        trackId: request.trackId,
      }) as IpcLyricsPayload | null;
      return normalizeIpcLyrics(payload);
    } catch (error) {
      throw asError(error, `fetch_lrclib_lyrics failed for track "${request.trackId}"`);
    }
  }
}

export class TauriLyricsApi extends IpcLyricsApi {}

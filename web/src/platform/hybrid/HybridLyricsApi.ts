import type { LyricsApi, RemoteLyricsRequest, TrackLyrics } from '../contracts';
import { cloudNeedsLocalLanguageLookup, pickPreferredLyrics } from '../../services/lyricsRank';

/**
 * Desktop lyrics: embedded/local file via IPC, cloud resolve via the API
 * (PostgreSQL cache + LRCLIB on the server) when signed in.
 */
export class HybridLyricsApi implements LyricsApi {
  constructor(
    private readonly local: LyricsApi,
    private readonly cloud: LyricsApi,
    private readonly isAuthenticated: () => boolean,
  ) {}

  async getTrackLyrics(trackId: string): Promise<TrackLyrics | null> {
    try {
      const local = await this.local.getTrackLyrics(trackId);
      if (local) return local;
    } catch (error) {
      console.warn('Local lyrics unavailable.', error);
    }
    if (!this.isAuthenticated()) return null;
    return this.cloud.getTrackLyrics(trackId);
  }

  async fetchRemoteLyrics(request: RemoteLyricsRequest): Promise<TrackLyrics | null> {
    if (!this.isAuthenticated()) return this.local.fetchRemoteLyrics(request);

    const cloud = await this.cloud.fetchRemoteLyrics(request);
    if (!cloudNeedsLocalLanguageLookup(cloud, request)) return cloud;

    // Ask desktop LRCLIB when cloud is missing, plain-only, or the wrong
    // language so synchronized or original-language lyrics can still win.
    try {
      const local = await this.local.fetchRemoteLyrics(request);
      return pickPreferredLyrics([
        cloud ? { lyrics: cloud, source: 'remote' } : null,
        local ? { lyrics: local, source: 'remote' } : null,
      ], request);
    } catch (error) {
      console.warn('Direct synchronized lyrics lookup unavailable.', error);
      return cloud;
    }
  }
}

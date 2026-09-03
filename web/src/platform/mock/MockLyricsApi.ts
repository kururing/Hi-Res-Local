import { parseLrc } from '../../services/lrc';
import type { LyricsApi, RemoteLyricsRequest, TrackLyrics } from '../contracts';
import type { MockDataStore } from './MockDataStore';

/**
 * In-memory lyrics adapter. Local lyrics come from the shared track store;
 * remote lookup stays a deterministic preview no-op (no network).
 */
export class MockLyricsApi implements LyricsApi {
  constructor(private readonly store: MockDataStore) {}

  getTrackLyrics(trackId: string): Promise<TrackLyrics | null> {
    const track = this.store.getTrackById(trackId);
    if (!track?.lyrics) return Promise.resolve(null);
    const romanized = this.store.getRomanizedLyrics(track.id);
    return Promise.resolve(parseLrc(track.lyrics, romanized));
  }

  fetchRemoteLyrics(_request: RemoteLyricsRequest): Promise<TrackLyrics | null> {
    return Promise.resolve(null);
  }
}

export interface LyricsProviderRequest {
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  genre?: string | null;
  language?: string | null;
}

export interface LyricsProviderResult {
  instrumental: boolean;
  syncedLrc?: string | null;
  plainText?: string | null;
  source: string;
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
}

export interface LyricsProvider {
  resolve(request: LyricsProviderRequest): Promise<LyricsProviderResult | null>;
}

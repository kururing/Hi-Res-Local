export interface LyricLine {
  timestamp: number; // in seconds
  text: string;
  romanized?: string;
  translation?: string;
}

export interface LyricData {
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
  offset?: number;
  lines: LyricLine[];
  is_synced: boolean;
  plain_text?: string;
  source?: 'local' | 'lrclib';
  romanized?: LyricData;
  /** True when a provider reports the track as instrumental. */
  instrumental?: boolean;
}

export type LyricsMode = 'original' | 'romanized' | 'both';

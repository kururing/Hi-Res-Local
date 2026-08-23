export interface LyricLine {
  timestamp: number; // in seconds
  text: string;
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
}

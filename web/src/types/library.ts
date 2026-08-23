/**
 * Library and metadata domain types for Nghe Nhac Pro Max.
 */

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  path: string;
  track_number?: number | null;
  disc_number?: number | null;
  year?: number | null;
  genre?: string | null;
  sample_rate?: number | null;
  bitrate?: number | null; // in kbps
  channels?: number | null;
  date_added: string; // ISO timestamp
  is_favorite?: boolean;
  rating?: number; // 0 to 5 stars
  play_count?: number;
  last_played?: string | null;
  lyrics?: string | null; // Raw LRC or plain text
  format?: string; // 'FLAC' | 'MP3' | 'WAV' | 'AAC' | 'OGG' | 'ALAC' | 'OPUS'
  bits_per_sample?: number; // 16, 24, 32
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  year?: number | null;
  genre?: string | null;
  track_count: number;
  total_duration: number; // seconds
  cover_url?: string | null;
  tracks: Track[];
}

export interface Artist {
  id: string;
  name: string;
  track_count: number;
  album_count: number;
  albums: Album[];
  genres: string[];
}

export interface Genre {
  name: string;
  track_count: number;
  total_duration: number;
  color_gradient: string;
}

export interface LibraryStats {
  total_tracks: number;
  total_artists: number;
  total_albums: number;
  total_duration_secs: number;
  total_size_bytes?: number;
}

export interface ScanProgress {
  total_files: number;
  scanned_files: number;
  current_path?: string | null;
  is_scanning: boolean;
}

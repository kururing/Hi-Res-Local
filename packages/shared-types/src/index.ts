export type TrackSource = 'local' | 'cloud' | 'local_and_cloud';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  duration_ms?: number;
  path: string;
  source?: TrackSource;
  cloudTrackId?: string | null;
  track_number?: number | null;
  disc_number?: number | null;
  year?: number | null;
  genre?: string | null;
  sample_rate?: number | null;
  bitrate?: number | null;
  channels?: number | null;
  date_added: string;
  is_favorite?: boolean;
  play_count?: number;
  last_played?: string | null;
  lyrics?: string | null;
  format?: string;
  bits_per_sample?: number;
  bit_depth?: number | null;
  cover_art_path?: string | null;
  artist_image_url?: string | null;
  last_played_at?: string | null;
  lossless?: boolean | null;
  hi_res?: boolean | null;
  is_mqa?: boolean | null;
  mqa_status?: 'mqa' | 'mqa_studio' | 'mqa_authenticated' | null;
  dsd_rate?: number | null;
  isrc?: string | null;
  musicbrainz_track_id?: string | null;
  checksum_sha256?: string | null;
  replaygain_track_gain?: number | null;
  replaygain_track_peak?: number | null;
  replaygain_album_gain?: number | null;
  replaygain_album_peak?: number | null;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  year?: number | null;
  genre?: string | null;
  track_count: number;
  total_duration: number;
  cover_url?: string | null;
  tracks: Track[];
}

export interface Artist {
  id: string;
  name: string;
  image_url?: string | null;
  track_count: number;
  album_count: number;
  albums: Album[];
  genres: string[];
}

export interface LibraryStats {
  total_tracks: number;
  total_artists: number;
  total_albums: number;
  total_duration_secs: number;
  total_size_bytes?: number;
}

export interface UserCapabilities {
  catalog_admin: boolean;
  admin: boolean;
}

export interface AuthUserView {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  roles: string[];
  capabilities: UserCapabilities;
  permissions: string[];
}

export const CATALOG_READ = 'catalog.read';
export const CATALOG_WRITE = 'catalog.write';
export const USERS_ROLES = 'users.roles';

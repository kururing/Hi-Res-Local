/**
 * Library and metadata domain types for Nghe Nhac Pro Max.
 * Canonical definitions live in `@nnpm/shared-types`.
 */

export type {
  Album,
  Artist,
  LibraryStats,
  Track,
  TrackSource,
} from '@nnpm/shared-types';

export interface Genre {
  name: string;
  track_count: number;
  total_duration: number;
  color_gradient: string;
}

export interface ScanProgress {
  total_files: number;
  scanned_files: number;
  current_path?: string | null;
  is_scanning: boolean;
}

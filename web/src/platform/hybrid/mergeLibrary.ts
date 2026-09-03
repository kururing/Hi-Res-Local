import { isLocalFilePath } from '../web/WebLibraryApi';
import type { LibraryStats, Track, TrackSource } from '../../types/library';

const DURATION_TOLERANCE_SECONDS = 2;

export function normalizeMergeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function trackDurationSeconds(track: Track): number {
  if (Number.isFinite(track.duration) && track.duration > 0) return track.duration;
  return Math.max(0, (track.duration_ms ?? 0) / 1000);
}

export function metadataMergeKey(track: Track): string {
  return [
    normalizeMergeText(track.title),
    normalizeMergeText(track.artist),
    normalizeMergeText(track.album),
  ].join('\u0000');
}

export function identityMergeKey(track: Track): string | null {
  const checksum = track.checksum_sha256?.trim().toLowerCase();
  if (checksum && /^[0-9a-f]{64}$/.test(checksum)) return `ck:${checksum}`;
  const isrc = track.isrc?.trim().toUpperCase();
  if (isrc && isrc.length >= 8) return `isrc:${isrc}`;
  const mbid = track.musicbrainz_track_id?.trim().toLowerCase();
  if (mbid) return `mb:${mbid}`;
  return null;
}

function withSource(track: Track, source: TrackSource, cloudTrackId?: string | null): Track {
  return {
    ...track,
    source,
    cloudTrackId: cloudTrackId ?? track.cloudTrackId ?? null,
  };
}

function identitiesConflict(local: Track, cloud: Track): boolean {
  const localId = identityMergeKey(local);
  const cloudId = identityMergeKey(cloud);
  return localId != null && cloudId != null && localId !== cloudId;
}

/**
 * Prefer checksum/ISRC/MBID identity. Metadata (title/artist/album ±2s) is
 * only a fallback when identifiers are missing or do not conflict.
 */
export function mergeLocalAndCloudTracks(localTracks: Track[], cloudTracks: Track[]): Track[] {
  const unmatchedCloud = [...cloudTracks];
  const merged = localTracks.map(local => {
    const identity = identityMergeKey(local);
    const localDuration = trackDurationSeconds(local);
    let cloudIndex = identity
      ? unmatchedCloud.findIndex(cloud => identityMergeKey(cloud) === identity)
      : -1;
    if (cloudIndex < 0) {
      const key = metadataMergeKey(local);
      cloudIndex = unmatchedCloud.findIndex(cloud => (
        metadataMergeKey(cloud) === key
        && Math.abs(trackDurationSeconds(cloud) - localDuration) <= DURATION_TOLERANCE_SECONDS
        && !identitiesConflict(local, cloud)
      ));
    }
    if (cloudIndex < 0) return withSource(local, 'local');

    const [cloud] = unmatchedCloud.splice(cloudIndex, 1);
    return withSource({
      ...local,
      isrc: local.isrc || cloud.isrc,
      musicbrainz_track_id: local.musicbrainz_track_id || cloud.musicbrainz_track_id,
      checksum_sha256: local.checksum_sha256 || cloud.checksum_sha256,
      cover_art_path: local.cover_art_path || cloud.cover_art_path,
      artist_image_url: local.artist_image_url || cloud.artist_image_url,
      format: local.format || cloud.format,
      is_favorite: Boolean(local.is_favorite || cloud.is_favorite),
    }, 'local_and_cloud', cloud.id);
  });

  for (const cloud of unmatchedCloud) {
    merged.push(withSource({
      ...cloud,
      path: '',
      cloudTrackId: cloud.id,
    }, 'cloud', cloud.id));
  }

  return merged;
}

export function statsFromTracks(tracks: Track[], localStats?: LibraryStats | null): LibraryStats {
  const artists = new Set(tracks.map(track => normalizeMergeText(track.artist)).filter(Boolean));
  const albums = new Set(
    tracks.map(track => `${normalizeMergeText(track.album)}\u0000${normalizeMergeText(track.artist)}`)
  );
  return {
    total_tracks: tracks.length,
    total_artists: artists.size,
    total_albums: albums.size,
    total_duration_secs: tracks.reduce((sum, track) => sum + trackDurationSeconds(track), 0),
    ...(localStats?.total_size_bytes != null ? { total_size_bytes: localStats.total_size_bytes } : {}),
  };
}

export function tagLocalTracks(tracks: Track[]): Track[] {
  return tracks.map(track => withSource(track, 'local'));
}

export function cloudTrackIdOf(track: Track): string | null {
  const explicit = track.cloudTrackId?.trim();
  if (explicit) return explicit;
  if (isLocalFilePath(track.path)) return null;
  const id = track.id.trim();
  if (id) return id;
  return null;
}

export function isCloudPlayback(track: Track): boolean {
  if (track.source === 'local') return false;
  if (isLocalFilePath(track.path)) return false;
  return cloudTrackIdOf(track) != null;
}

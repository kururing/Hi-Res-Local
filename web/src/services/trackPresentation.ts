import { Track } from '../types/library';

export interface BackendTrackFields {
  duration_ms?: number;
  cover_art_path?: string | null;
  last_played_at?: string | null;
}

export function normalizeLibraryTrack(track: Track & BackendTrackFields): Track {
  return {
    ...track,
    duration: Number.isFinite(track.duration) && track.duration > 0
      ? track.duration
      : Math.max(0, (track.duration_ms ?? 0) / 1000),
    cover_art_path: track.cover_art_path ?? null,
    last_played: track.last_played ?? track.last_played_at ?? null,
    bits_per_sample: track.bits_per_sample ?? track.bit_depth ?? undefined,
  };
}

export function formatQualityLabel(track: Track): string {
  const sampleRate = track.sample_rate && track.sample_rate > 0
    ? (track.sample_rate % 1000 === 0
      ? `${track.sample_rate / 1000} kHz`
      : `${(track.sample_rate / 1000).toFixed(1)} kHz`)
    : null;
  const bits = track.bit_depth ?? track.bits_per_sample;
  const depthOrBitrate = bits && bits > 0
    ? `${bits}-bit`
    : track.bitrate && track.bitrate > 0
      ? `${track.bitrate} kbps`
      : null;

  return [depthOrBitrate, sampleRate].filter(Boolean).join(' / ') || 'Audio';
}

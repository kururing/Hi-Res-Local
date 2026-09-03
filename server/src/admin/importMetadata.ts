import { classifyAudio } from '../ingestion/classification.js';
import { titleFromFilename, type MappedAudioTags } from '../ingestion/tags.js';
import type { ProbedAudioMetadata } from '../ingestion/probe.js';
import type { EmbeddedLyrics } from '../ingestion/embeddedLyrics.js';
import { UNKNOWN_ALBUM_TITLE, UNKNOWN_ARTIST_NAME } from './placeholders.js';

export interface ImportDetectedMetadata {
  title: string | null;
  artist: string | null;
  album_artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  date: string | null;
  track: number | null;
  track_total: number | null;
  disc: number | null;
  disc_total: number | null;
  composer: string | null;
  comment: string | null;
  label: string | null;
  copyright: string | null;
  bpm: number | null;
  isrc: string | null;
  upc: string | null;
  musicbrainz_track_id: string | null;
  musicbrainz_album_id: string | null;
  musicbrainz_artist_id: string | null;
  replaygain_track_gain: number | null;
  replaygain_track_peak: number | null;
  replaygain_album_gain: number | null;
  replaygain_album_peak: number | null;
  duration_seconds: number | null;
  container: string | null;
  codec: string | null;
  bitrate_kbps: number | null;
  sample_rate_hz: number | null;
  bit_depth: number | null;
  channels: number | null;
  channel_layout: string | null;
  lossless: boolean;
  hi_res: boolean;
  dsd: boolean;
  file_size_bytes: number | null;
  title_source: 'tag' | 'filename' | null;
  artist_source: 'tag' | 'album_artist' | 'unknown' | null;
  album_source: 'tag' | 'unknown' | null;
  artwork_public_url: string | null;
  artwork_error: string | null;
  has_attached_picture: boolean;
  lyrics_kind: 'synced' | 'plain' | null;
  lyrics_error: string | null;
  review_fields: string[];
}

export interface ImportOverrideMetadata {
  title?: string | null;
  artist?: string | null;
  album_artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  track?: number | null;
  track_total?: number | null;
  disc?: number | null;
  disc_total?: number | null;
  composer?: string | null;
  comment?: string | null;
  selected_artist_id?: string | null;
  selected_album_id?: string | null;
  rights_holder?: string | null;
  license_source_ref?: string | null;
  territory_scope?: string | null;
  rights_attested?: boolean;
}

export type EffectiveImportMetadata = ImportDetectedMetadata & {
  selected_artist_id: string | null;
  selected_album_id: string | null;
  rights_holder: string | null;
  license_source_ref: string | null;
  territory_scope: string | null;
  rights_attested: boolean;
};

const OVERRIDE_KEYS = [
  'title',
  'artist',
  'album_artist',
  'album',
  'genre',
  'year',
  'track',
  'track_total',
  'disc',
  'disc_total',
  'composer',
  'comment',
  'selected_artist_id',
  'selected_album_id',
  'rights_holder',
  'license_source_ref',
  'territory_scope',
  'rights_attested',
] as const;

export function emptyDetected(): ImportDetectedMetadata {
  return {
    title: null, artist: null, album_artist: null, album: null, genre: null, year: null, date: null,
    track: null, track_total: null, disc: null, disc_total: null, composer: null, comment: null,
    label: null, copyright: null, bpm: null, isrc: null, upc: null,
    musicbrainz_track_id: null, musicbrainz_album_id: null, musicbrainz_artist_id: null,
    replaygain_track_gain: null, replaygain_track_peak: null,
    replaygain_album_gain: null, replaygain_album_peak: null,
    duration_seconds: null, container: null, codec: null, bitrate_kbps: null, sample_rate_hz: null,
    bit_depth: null, channels: null, channel_layout: null, lossless: false, hi_res: false, dsd: false,
    file_size_bytes: null, title_source: null, artist_source: null, album_source: null,
    artwork_public_url: null, artwork_error: null, has_attached_picture: false,
    lyrics_kind: null, lyrics_error: null, review_fields: [],
  };
}

export function buildDetectedMetadata(input: {
  tags: MappedAudioTags;
  probed: ProbedAudioMetadata;
  filename: string;
  fileSizeBytes: number;
  lyrics?: EmbeddedLyrics | null;
  lyricsError?: string | null;
}): ImportDetectedMetadata {
  const classification = classifyAudio({
    codec: input.probed.codec,
    container: input.probed.container,
    sampleRateHz: input.probed.sampleRateHz,
    bitDepth: input.probed.bitDepth,
    isLossless: input.probed.isLossless,
  });
  const filenameTitle = titleFromFilename(input.filename);
  const titleTag = input.tags.title;
  const artistTag = input.tags.artist;
  const albumArtistTag = input.tags.albumArtist;
  const albumTag = input.tags.album;
  const artist = artistTag ?? albumArtistTag ?? UNKNOWN_ARTIST_NAME;
  const albumArtist = albumArtistTag ?? artist;
  const album = albumTag ?? UNKNOWN_ALBUM_TITLE;
  const title = titleTag ?? filenameTitle;
  const lyrics = input.lyrics ?? input.tags.lyrics;

  return {
    title,
    artist,
    album_artist: albumArtist,
    album,
    genre: input.tags.genre,
    year: input.tags.year,
    date: input.tags.date,
    track: input.tags.track,
    track_total: input.tags.trackTotal,
    disc: input.tags.disc,
    disc_total: input.tags.discTotal,
    composer: input.tags.composer,
    comment: input.tags.comment,
    label: input.tags.label,
    copyright: input.tags.copyright,
    bpm: input.tags.bpm,
    isrc: input.tags.isrc,
    upc: input.tags.upc,
    musicbrainz_track_id: input.tags.musicbrainzTrackId,
    musicbrainz_album_id: input.tags.musicbrainzAlbumId,
    musicbrainz_artist_id: input.tags.musicbrainzArtistId,
    replaygain_track_gain: input.tags.replaygainTrackGain,
    replaygain_track_peak: input.tags.replaygainTrackPeak,
    replaygain_album_gain: input.tags.replaygainAlbumGain,
    replaygain_album_peak: input.tags.replaygainAlbumPeak,
    duration_seconds: input.probed.durationSeconds,
    container: input.probed.container,
    codec: input.probed.codec,
    bitrate_kbps: input.probed.bitrateKbps,
    sample_rate_hz: input.probed.sampleRateHz,
    bit_depth: input.probed.bitDepth,
    channels: input.probed.channels,
    channel_layout: input.probed.channelLayout,
    lossless: classification.lossless,
    hi_res: classification.hiRes,
    dsd: classification.dsd,
    file_size_bytes: input.fileSizeBytes,
    title_source: titleTag ? 'tag' : filenameTitle ? 'filename' : null,
    artist_source: artistTag ? 'tag' : albumArtistTag ? 'album_artist' : 'unknown',
    album_source: albumTag ? 'tag' : 'unknown',
    artwork_public_url: null,
    artwork_error: null,
    has_attached_picture: input.probed.hasAttachedPicture,
    lyrics_kind: lyrics?.kind ?? null,
    lyrics_error: input.lyricsError ?? null,
    review_fields: [],
  };
}

export function mergeImportMetadata(
  detected: ImportDetectedMetadata,
  override: ImportOverrideMetadata,
): EffectiveImportMetadata {
  const title = pickOverride(override.title, detected.title);
  const artist = pickOverride(override.artist, detected.artist);
  const album = pickOverride(override.album, detected.album);
  const albumArtist = pickOverride(override.album_artist, detected.album_artist);
  return {
    ...detected,
    title,
    artist,
    album_artist: albumArtist,
    album,
    genre: pickOverride(override.genre, detected.genre),
    year: override.year !== undefined ? override.year : detected.year,
    track: override.track !== undefined ? override.track : detected.track,
    track_total: override.track_total !== undefined ? override.track_total : detected.track_total,
    disc: override.disc !== undefined ? override.disc : detected.disc,
    disc_total: override.disc_total !== undefined ? override.disc_total : detected.disc_total,
    composer: pickOverride(override.composer, detected.composer),
    comment: pickOverride(override.comment, detected.comment),
    review_fields: [],
    selected_artist_id: override.selected_artist_id ?? null,
    selected_album_id: override.selected_album_id ?? null,
    rights_holder: override.rights_holder ?? null,
    license_source_ref: override.license_source_ref ?? null,
    territory_scope: override.territory_scope ?? null,
    rights_attested: override.rights_attested === true,
  };
}

export function reviewFields(_input: {
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
}): string[] {
  return [];
}

export function sanitizeOverride(body: Record<string, unknown>): ImportOverrideMetadata {
  const next: ImportOverrideMetadata = {};
  for (const key of OVERRIDE_KEYS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (key === 'rights_attested') {
      if (value !== true && value !== false) continue;
      next.rights_attested = value;
      continue;
    }
    if (key === 'year' || key === 'track' || key === 'track_total' || key === 'disc' || key === 'disc_total') {
      if (value == null || value === '') {
        next[key] = null;
        continue;
      }
      if (typeof value === 'number' && Number.isInteger(value)) next[key] = value;
      continue;
    }
    if (value == null) {
      (next as Record<string, unknown>)[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      (next as Record<string, unknown>)[key] = value.trim() || null;
    }
  }
  return next;
}

function pickOverride(override: string | null | undefined, detected: string | null): string | null {
  if (override !== undefined) return override;
  return detected;
}

export function importIsReady(effective: EffectiveImportMetadata): boolean {
  return Boolean(effective.title?.trim() && effective.artist?.trim() && effective.album?.trim());
}

export function isUnknownArtistName(name: string | null | undefined): boolean {
  return (name ?? '').trim() === UNKNOWN_ARTIST_NAME;
}

export function isUnknownAlbumTitle(title: string | null | undefined): boolean {
  return (title ?? '').trim() === UNKNOWN_ALBUM_TITLE;
}

export function asDetected(value: unknown): ImportDetectedMetadata {
  return { ...emptyDetected(), ...(value && typeof value === 'object' ? value as ImportDetectedMetadata : {}) };
}

import { detectEmbeddedLyrics, type EmbeddedLyrics } from './embeddedLyrics.js';

export interface MappedAudioTags {
  title: string | null;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  genre: string | null;
  date: string | null;
  year: number | null;
  track: number | null;
  trackTotal: number | null;
  disc: number | null;
  discTotal: number | null;
  composer: string | null;
  comment: string | null;
  label: string | null;
  copyright: string | null;
  bpm: number | null;
  isrc: string | null;
  upc: string | null;
  musicbrainzTrackId: string | null;
  musicbrainzAlbumId: string | null;
  musicbrainzArtistId: string | null;
  replaygainTrackGain: number | null;
  replaygainTrackPeak: number | null;
  replaygainAlbumGain: number | null;
  replaygainAlbumPeak: number | null;
  lyrics: EmbeddedLyrics | null;
}

const TAG_ALIASES: Record<string, string[]> = {
  title: ['title', 'tit2', 'inam'],
  artist: ['artist', 'art', 'tpe1', 'iart'],
  albumArtist: ['album_artist', 'albumartist', 'album artist', 'tpe2'],
  album: ['album', 'talb', 'iprd'],
  genre: ['genre', 'tcon', 'ignr'],
  date: ['date', 'tdrc', 'tyer', 'year', 'icrd'],
  year: ['year', 'tyer', 'date', 'tdrc', 'icrd'],
  track: ['track', 'tracknumber', 'track_number', 'trck', 'itrk'],
  trackTotal: ['tracktotal', 'track_total', 'totaltracks'],
  disc: ['disc', 'discnumber', 'disc_number', 'tpos'],
  discTotal: ['disctotal', 'disc_total', 'totaldiscs'],
  composer: ['composer', 'tcom'],
  comment: ['comment', 'comm', 'description'],
  label: ['label', 'publisher', 'tpub', 'organization', 'organisation'],
  copyright: ['copyright', 'tcop'],
  bpm: ['bpm', 'tbpm'],
  isrc: ['isrc', 'tsrc'],
  upc: ['upc', 'barcode', 'ean', 'mcn'],
  musicbrainzTrackId: [
    'musicbrainz_trackid',
    'musicbrainz track id',
    'musicbrainz_releasetrackid',
    'ufid',
  ],
  musicbrainzAlbumId: [
    'musicbrainz_albumid',
    'musicbrainz album id',
    'musicbrainz_releasegroupid',
  ],
  musicbrainzArtistId: [
    'musicbrainz_artistid',
    'musicbrainz artist id',
    'musicbrainz_albumartistid',
  ],
  replaygainTrackGain: ['replaygain_track_gain', 'replaygain track gain'],
  replaygainTrackPeak: ['replaygain_track_peak', 'replaygain track peak'],
  replaygainAlbumGain: ['replaygain_album_gain', 'replaygain album gain'],
  replaygainAlbumPeak: ['replaygain_album_peak', 'replaygain album peak'],
};

export function emptyMappedTags(): MappedAudioTags {
  return {
    title: null,
    artist: null,
    albumArtist: null,
    album: null,
    genre: null,
    date: null,
    year: null,
    track: null,
    trackTotal: null,
    disc: null,
    discTotal: null,
    composer: null,
    comment: null,
    label: null,
    copyright: null,
    bpm: null,
    isrc: null,
    upc: null,
    musicbrainzTrackId: null,
    musicbrainzAlbumId: null,
    musicbrainzArtistId: null,
    replaygainTrackGain: null,
    replaygainTrackPeak: null,
    replaygainAlbumGain: null,
    replaygainAlbumPeak: null,
    lyrics: null,
  };
}

export function lowercaseTagMap(tags: Record<string, unknown> | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!tags || typeof tags !== 'object') return map;
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    const normalized = key.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const compact = normalized.replace(/\s+/g, '');
    if (!map.has(normalized)) map.set(normalized, text);
    if (!map.has(compact)) map.set(compact, text);
  }
  return map;
}

export function mergeTagMaps(...maps: Array<Map<string, string>>): Map<string, string> {
  const merged = new Map<string, string>();
  for (const map of maps) {
    for (const [key, value] of map) {
      if (!merged.has(key)) merged.set(key, value);
    }
  }
  return merged;
}

function lookup(map: Map<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const key = alias.toLowerCase();
    const compact = key.replace(/[\s_-]+/g, '');
    const value = map.get(key) ?? map.get(compact);
    if (value) return value;
  }
  return null;
}

export function parseSlashNumber(value: string | null): { current: number | null; total: number | null } {
  if (!value) return { current: null, total: null };
  const match = value.trim().match(/^(\d+)\s*(?:\/\s*(\d+))?$/);
  if (!match) return { current: null, total: null };
  const current = Number(match[1]);
  const total = match[2] ? Number(match[2]) : null;
  return {
    current: Number.isInteger(current) && current > 0 ? current : null,
    total: total && Number.isInteger(total) && total > 0 ? total : null,
  };
}

export function yearFromDate(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 9999 ? year : null;
}

export function parseReplayGain(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBpm(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.trim().replace(/[^\d.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 400) return null;
  return Math.round(parsed * 1000) / 1000;
}

const SOURCE_URL = /https?:\/\/|www\./i;

export function sanitizePublicComment(value: string | null): string | null {
  if (!value?.trim()) return null;
  if (SOURCE_URL.test(value)) return null;
  return value.trim();
}

export function normalizeIsrc(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(compact) && !/^[A-Z0-9]{8,15}$/.test(compact)) {
    return compact.length >= 8 && compact.length <= 15 ? compact : null;
  }
  return compact;
}

export function normalizeUpc(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 18) return null;
  return digits;
}

const MUSICBRAINZ_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function normalizeMusicBrainzId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const uuid = trimmed.match(MUSICBRAINZ_UUID);
  if (uuid?.[0]) return uuid[0].toLowerCase();
  const compact = trimmed.replace(/[^A-Za-z0-9-]/g, '');
  if (compact.length >= 1 && compact.length <= 64) return compact;
  return null;
}

export function mapNnpmProbeTags(tags: Record<string, unknown> | undefined | null): MappedAudioTags {
  return mapTagRecord(lowercaseTagMap(tags));
}

export function mapTagRecord(map: Map<string, string>): MappedAudioTags {
  const date = lookup(map, TAG_ALIASES.date ?? []);
  const yearRaw = lookup(map, ['year', 'tyer']);
  const trackRaw = lookup(map, TAG_ALIASES.track ?? []);
  const discRaw = lookup(map, TAG_ALIASES.disc ?? []);
  const track = parseSlashNumber(trackRaw);
  const disc = parseSlashNumber(discRaw);
  const trackTotal = parseSlashNumber(lookup(map, TAG_ALIASES.trackTotal ?? [])).current ?? track.total;
  const discTotal = parseSlashNumber(lookup(map, TAG_ALIASES.discTotal ?? [])).current ?? disc.total;

  return {
    title: lookup(map, TAG_ALIASES.title ?? []),
    artist: lookup(map, TAG_ALIASES.artist ?? []),
    albumArtist: lookup(map, TAG_ALIASES.albumArtist ?? []),
    album: lookup(map, TAG_ALIASES.album ?? []),
    genre: lookup(map, TAG_ALIASES.genre ?? []),
    date,
    year: yearFromDate(yearRaw) ?? yearFromDate(date),
    track: track.current,
    trackTotal,
    disc: disc.current,
    discTotal,
    composer: lookup(map, TAG_ALIASES.composer ?? []),
    comment: sanitizePublicComment(lookup(map, TAG_ALIASES.comment ?? [])),
    label: lookup(map, TAG_ALIASES.label ?? []),
    copyright: lookup(map, TAG_ALIASES.copyright ?? []),
    bpm: parseBpm(lookup(map, TAG_ALIASES.bpm ?? [])),
    isrc: normalizeIsrc(lookup(map, TAG_ALIASES.isrc ?? [])),
    upc: normalizeUpc(lookup(map, TAG_ALIASES.upc ?? [])),
    musicbrainzTrackId: normalizeMusicBrainzId(lookup(map, TAG_ALIASES.musicbrainzTrackId ?? [])),
    musicbrainzAlbumId: normalizeMusicBrainzId(lookup(map, TAG_ALIASES.musicbrainzAlbumId ?? [])),
    musicbrainzArtistId: normalizeMusicBrainzId(lookup(map, TAG_ALIASES.musicbrainzArtistId ?? [])),
    replaygainTrackGain: parseReplayGain(lookup(map, TAG_ALIASES.replaygainTrackGain ?? [])),
    replaygainTrackPeak: parseReplayGain(lookup(map, TAG_ALIASES.replaygainTrackPeak ?? [])),
    replaygainAlbumGain: parseReplayGain(lookup(map, TAG_ALIASES.replaygainAlbumGain ?? [])),
    replaygainAlbumPeak: parseReplayGain(lookup(map, TAG_ALIASES.replaygainAlbumPeak ?? [])),
    lyrics: detectEmbeddedLyrics(map),
  };
}

export function titleFromFilename(filename: string): string | null {
  const normalized = filename.replace(/\\/g, '/').trim();
  const base = normalized.split('/').filter(Boolean).at(-1) ?? '';
  if (!base) return null;
  const withoutExt = base.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  const title = withoutExt.replace(/\s+/g, ' ').trim();
  if (!title || title.length > 300) return null;
  return title;
}

export function extractNnpmProbeTagMaps(root: {
  format?: { tags?: Record<string, unknown> };
  streams?: Array<{ codec_type?: string; tags?: Record<string, unknown> }>;
}): Map<string, string> {
  const formatTags = lowercaseTagMap(root.format?.tags);
  const audio = (root.streams ?? []).find((stream) => stream.codec_type === 'audio');
  const streamTags = lowercaseTagMap(audio?.tags);
  return mergeTagMaps(formatTags, streamTags);
}

export function hasAttachedPicture(root: {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    disposition?: { attached_pic?: number };
  }>;
}): boolean {
  return (root.streams ?? []).some((stream) => {
    if (stream.disposition?.attached_pic === 1) return true;
    if (stream.codec_type !== 'video') return false;
    const codec = (stream.codec_name ?? '').toLowerCase();
    return codec === 'mjpeg' || codec === 'png' || codec === 'webp' || codec === 'bmp';
  });
}

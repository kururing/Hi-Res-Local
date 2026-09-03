/**
 * Frontend `Track` from web/src/types/library.ts.
 * Cloud responses must match this shape. `path` is always empty because the
 * browser runtime must never receive desktop filesystem locations.
 */
export interface FrontendTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  duration_ms: number;
  path: string;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  genre: string | null;
  sample_rate: number | null;
  bitrate: number | null;
  channels: number | null;
  date_added: string;
  is_favorite: boolean;
  play_count: number;
  last_played: string | null;
  lyrics: string | null;
  format?: string;
  bits_per_sample?: number;
  bit_depth: number | null;
  cover_art_path: string | null;
  artist_image_url: string | null;
  last_played_at: string | null;
  lossless: boolean | null;
  hi_res: boolean | null;
  dsd_rate: number | null;
  is_mqa: boolean | null;
  mqa_status: string | null;
  replaygain_track_gain: number | null;
  replaygain_track_peak: number | null;
  replaygain_album_gain: number | null;
  replaygain_album_peak: number | null;
  isrc: string | null;
  musicbrainz_track_id: string | null;
  checksum_sha256: string | null;
}

export interface FrontendAlbum {
  id: string;
  name: string;
  artist: string;
  year: number | null;
  genre: string | null;
  track_count: number;
  total_duration: number;
  cover_url: string | null;
  tracks: FrontendTrack[];
}

export interface FrontendArtist {
  id: string;
  name: string;
  image_url: string | null;
  track_count: number;
  album_count: number;
  albums: FrontendAlbum[];
  genres: string[];
}

export interface FrontendLibraryStats {
  total_tracks: number;
  total_artists: number;
  total_albums: number;
  total_duration_secs: number;
  total_size_bytes: number;
}

export function emptyLibraryStats(): FrontendLibraryStats {
  return {
    total_tracks: 0,
    total_artists: 0,
    total_albums: 0,
    total_duration_secs: 0,
    total_size_bytes: 0,
  };
}

export interface DisplayAsset {
  container: string | null;
  codec: string | null;
  sampleRateHz: number | null;
  bitDepth: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  lossless: boolean | null;
  hiRes: boolean | null;
  dsdRate: number | null;
  isMqa?: boolean;
  mqaStatus?: string | null;
  replaygainTrackGain: number | null;
  replaygainTrackPeak: number | null;
  replaygainAlbumGain: number | null;
  replaygainAlbumPeak: number | null;
}

export interface NamedArtist {
  name: string;
  image_url?: string | null;
}

export interface UserTrackState {
  isFavorite: boolean;
  playCount: number;
  lastPlayedAt: string | null;
}

export const DEFAULT_USER_TRACK_STATE: UserTrackState = {
  isFavorite: false,
  playCount: 0,
  lastPlayedAt: null,
};

export interface TrackMapperInput {
  id: string;
  title: string;
  albumTitle: string | null;
  durationSeconds: number;
  trackNumber: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  dateAdded: Date | string;
  coverArtUrl: string | null;
  artists: NamedArtist[];
  displayAsset: DisplayAsset | null;
  userState?: UserTrackState;
  isrc?: string | null;
  musicbrainzTrackId?: string | null;
  checksumSha256?: string | null;
}

function formatLabel(container: string | null, codec: string | null): string | undefined {
  const value = (container ?? codec ?? '').trim();
  if (!value) return undefined;
  return value.toUpperCase();
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function firstArtistImageUrl(artists: NamedArtist[]): string | null {
  for (const artist of artists) {
    const url = artist.image_url?.trim();
    if (url) return url;
  }
  return null;
}

export function toFrontendTrack(input: TrackMapperInput): FrontendTrack {
  const duration = Number(input.durationSeconds);
  const asset = input.displayAsset;
  const bitDepth = asset?.bitDepth ?? null;
  const format = formatLabel(asset?.container ?? null, asset?.codec ?? null);
  const userState = input.userState ?? DEFAULT_USER_TRACK_STATE;

  return {
    id: input.id,
    title: input.title,
    artist: input.artists.map((artist) => artist.name).filter(Boolean).join(', ') || 'Unknown Artist',
    album: input.albumTitle ?? '',
    duration,
    duration_ms: Math.round(duration * 1000),
    path: '',
    track_number: input.trackNumber,
    disc_number: input.discNumber,
    year: input.year,
    genre: input.genre,
    sample_rate: asset?.sampleRateHz ?? null,
    bitrate: asset?.bitrateKbps ?? null,
    channels: asset?.channels ?? null,
    date_added: iso(input.dateAdded),
    is_favorite: userState.isFavorite,
    play_count: userState.playCount,
    last_played: userState.lastPlayedAt,
    lyrics: null,
    format,
    bits_per_sample: bitDepth ?? undefined,
    bit_depth: bitDepth,
    cover_art_path: input.coverArtUrl,
    artist_image_url: firstArtistImageUrl(input.artists),
    last_played_at: userState.lastPlayedAt,
    lossless: asset?.lossless ?? null,
    hi_res: asset?.hiRes ?? null,
    dsd_rate: asset?.dsdRate ?? null,
    is_mqa: asset?.isMqa ?? null,
    mqa_status: asset?.mqaStatus ?? null,
    replaygain_track_gain: asset?.replaygainTrackGain ?? null,
    replaygain_track_peak: asset?.replaygainTrackPeak ?? null,
    replaygain_album_gain: asset?.replaygainAlbumGain ?? null,
    replaygain_album_peak: asset?.replaygainAlbumPeak ?? null,
    isrc: input.isrc ?? null,
    musicbrainz_track_id: input.musicbrainzTrackId ?? null,
    checksum_sha256: input.checksumSha256 ?? null,
  };
}

export function assertNoStorageKey(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (serialized.includes('storage_key') || serialized.includes('storageKey')) {
    throw new Error('API payload leaked a storage key.');
  }
}

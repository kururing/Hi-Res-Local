import { Type } from '@sinclair/typebox';

export const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
export const NullableString = Type.Union([Type.String(), Type.Null()]);
export const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);

export const FrontendTrackSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  artist: Type.String(),
  album: Type.String(),
  duration: Type.Number(),
  duration_ms: Type.Integer(),
  path: Type.String(),
  track_number: NullableInteger,
  disc_number: NullableInteger,
  year: NullableInteger,
  genre: NullableString,
  sample_rate: NullableInteger,
  bitrate: NullableInteger,
  channels: NullableInteger,
  date_added: Type.String({ format: 'date-time' }),
  is_favorite: Type.Boolean(),
  play_count: Type.Integer(),
  last_played: NullableString,
  lyrics: NullableString,
  format: Type.Optional(Type.String()),
  bits_per_sample: Type.Optional(Type.Integer()),
  bit_depth: NullableInteger,
  cover_art_path: NullableString,
  artist_image_url: NullableString,
  last_played_at: NullableString,
  lossless: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  hi_res: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  dsd_rate: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  replaygain_track_gain: Type.Optional(NullableNumber),
  replaygain_track_peak: Type.Optional(NullableNumber),
  replaygain_album_gain: Type.Optional(NullableNumber),
  replaygain_album_peak: Type.Optional(NullableNumber),
});

export const FrontendAlbumSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  artist: Type.String(),
  year: NullableInteger,
  genre: NullableString,
  track_count: Type.Integer(),
  total_duration: Type.Number(),
  cover_url: NullableString,
  tracks: Type.Array(FrontendTrackSchema),
});

export const FrontendArtistSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  image_url: NullableString,
  track_count: Type.Integer(),
  album_count: Type.Integer(),
  albums: Type.Array(FrontendAlbumSchema),
  genres: Type.Array(Type.String()),
});

export const FrontendLibraryStatsSchema = Type.Object({
  total_tracks: Type.Integer(),
  total_artists: Type.Integer(),
  total_albums: Type.Integer(),
  total_duration_secs: Type.Number(),
  total_size_bytes: Type.Integer(),
});

export const SearchQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ minLength: 0, maxLength: 200 })),
  type: Type.Optional(Type.Union([
    Type.Literal('all'),
    Type.Literal('track'),
    Type.Literal('album'),
    Type.Literal('artist'),
  ])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
});

export const SearchItemSchema = Type.Union([
  Type.Object({
    type: Type.Literal('artist'),
    id: Type.String({ format: 'uuid' }),
    artist: Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      image_url: NullableString,
      track_count: Type.Integer(),
      album_count: Type.Integer(),
    }),
  }),
  Type.Object({
    type: Type.Literal('album'),
    id: Type.String({ format: 'uuid' }),
    album: Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      artist: Type.String(),
      year: NullableInteger,
      track_count: Type.Integer(),
      total_duration: Type.Number(),
      cover_url: NullableString,
    }),
  }),
  Type.Object({
    type: Type.Literal('track'),
    id: Type.String({ format: 'uuid' }),
    track: FrontendTrackSchema,
  }),
]);

export const SearchResponseSchema = Type.Object({
  items: Type.Array(SearchItemSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
  has_more: Type.Boolean(),
});

export const CatalogListQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
});

export const AlbumListPageSchema = Type.Object({
  items: Type.Array(FrontendAlbumSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
  has_more: Type.Boolean(),
});

export const ArtistListPageSchema = Type.Object({
  items: Type.Array(FrontendArtistSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
  has_more: Type.Boolean(),
});

export const TrackListPageSchema = Type.Object({
  items: Type.Array(FrontendTrackSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
  has_more: Type.Boolean(),
});

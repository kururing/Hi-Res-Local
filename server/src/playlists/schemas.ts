import { Type } from '@sinclair/typebox';
import { FrontendTrackSchema, NullableString } from '../catalog/schemas.js';
import {
  PLAYLIST_COVER_MAX,
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_NAME_MAX,
  PLAYLIST_RULES_MAX,
} from './validation.js';

export const BackendPlaylistSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(NullableString),
  is_smart: Type.Boolean(),
  rules_json: Type.Optional(NullableString),
  cover_art_path: Type.Optional(NullableString),
  track_count: Type.Integer(),
  total_duration_ms: Type.Integer(),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const PlaylistDetailsSchema = Type.Object({
  playlist: BackendPlaylistSchema,
  tracks: Type.Array(FrontendTrackSchema),
});

export const CreatePlaylistBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: PLAYLIST_NAME_MAX }),
  description: Type.Optional(Type.Union([
    Type.String({ maxLength: PLAYLIST_DESCRIPTION_MAX }),
    Type.Null(),
  ])),
  is_smart: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  rules_json: Type.Optional(Type.Union([
    Type.String({ maxLength: PLAYLIST_RULES_MAX }),
    Type.Null(),
    Type.Object({}, { additionalProperties: true }),
    Type.Array(Type.Unknown()),
  ])),
});

export const PatchPlaylistBodySchema = Type.Object({
  name: Type.Optional(Type.Union([
    Type.String({ minLength: 1, maxLength: PLAYLIST_NAME_MAX }),
    Type.Null(),
  ])),
  description: Type.Optional(Type.Union([
    Type.String({ maxLength: PLAYLIST_DESCRIPTION_MAX }),
    Type.Null(),
  ])),
  is_smart: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  rules_json: Type.Optional(Type.Union([
    Type.String({ maxLength: PLAYLIST_RULES_MAX }),
    Type.Null(),
    Type.Object({}, { additionalProperties: true }),
    Type.Array(Type.Unknown()),
  ])),
  cover_art_path: Type.Optional(Type.Union([
    Type.String({ maxLength: PLAYLIST_COVER_MAX }),
    Type.Null(),
  ])),
});

export const PlaylistTrackIdsBodySchema = Type.Object({
  track_ids: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 }),
});

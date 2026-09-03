import { Type } from '@sinclair/typebox';
import { NullableString } from '../catalog/schemas.js';

export const LyricLineSchema = Type.Object({
  timestamp_seconds: Type.Number(),
  text: Type.String(),
});

export const LyricsResponseSchema = Type.Object({
  is_synced: Type.Boolean(),
  lines: Type.Array(LyricLineSchema),
  plain_text: NullableString,
  source: Type.String(),
  instrumental: Type.Boolean(),
  title: Type.Optional(NullableString),
  artist: Type.Optional(NullableString),
  album: Type.Optional(NullableString),
  by: Type.Optional(NullableString),
  offset: Type.Optional(Type.Number()),
});

export const ResolveLyricsBodySchema = Type.Object({
  track_id: Type.String({ format: 'uuid' }),
  title: Type.Optional(Type.String({ maxLength: 300 })),
  artist: Type.Optional(Type.String({ maxLength: 200 })),
  album: Type.Optional(Type.String({ maxLength: 300 })),
  duration_seconds: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400 })),
});

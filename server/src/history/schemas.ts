import { Type } from '@sinclair/typebox';
import { FrontendTrackSchema } from '../catalog/schemas.js';
import { HISTORY_MAX_LIMIT, IDEMPOTENCY_KEY_MAX } from './validation.js';

export const PlayHistoryEntrySchema = Type.Object({
  id: Type.Integer(),
  track_id: Type.String({ format: 'uuid' }),
  track: Type.Union([FrontendTrackSchema, Type.Null()]),
  played_at: Type.String({ format: 'date-time' }),
  completed_duration_ms: Type.Integer(),
  fully_played: Type.Boolean(),
});

export const RecordHistoryBodySchema = Type.Object({
  track_id: Type.String({ format: 'uuid' }),
  completed_duration_ms: Type.Integer({ minimum: 0, maximum: 86_400_000 }),
  fully_played: Type.Boolean(),
  client_request_id: Type.Optional(Type.String({ minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX })),
});

export const HistoryQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: HISTORY_MAX_LIMIT })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const HistoryHeadersSchema = Type.Object({
  'idempotency-key': Type.Optional(Type.String({ minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX })),
}, { additionalProperties: true });

import { Type } from '@sinclair/typebox';

export const ErrorEnvelopeSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  request_id: Type.String(),
});

export const UuidParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export const TrackIdParams = Type.Object({
  trackId: Type.String({ format: 'uuid' }),
});

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ErrorEnvelopeSchema, TrackIdParams } from '../http/schemas.js';
import type { QualityPreset } from './assetSelector.js';

const QualitySchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('high'),
  Type.Literal('lossless'),
  Type.Literal('max'),
  Type.Literal('maximum'),
  Type.Literal('original'),
  Type.Literal('hires'),
  Type.Literal('compatible'),
  Type.Literal('data-saver'),
]);

const SupportedFormatSchema = Type.Object({
  codec: Type.String({ minLength: 1 }),
  container: Type.String({ minLength: 1 }),
  mime_type: Type.Optional(Type.String({ minLength: 1 })),
});

const StreamBodySchema = Type.Object({
  quality: Type.Optional(QualitySchema),
  supported_formats: Type.Optional(Type.Array(SupportedFormatSchema)),
});

const StreamQuerySchema = Type.Object({
  quality: Type.Optional(QualitySchema),
});

const StreamAssetSchema = Type.Object({
  codec: Type.String(),
  container: Type.String(),
  mime_type: Type.Optional(Type.String()),
  sample_rate_hz: Type.Integer(),
  bit_depth: Type.Union([Type.Integer(), Type.Null()]),
  channels: Type.Integer(),
  bitrate_kbps: Type.Union([Type.Integer(), Type.Null()]),
  lossless: Type.Boolean(),
  file_size_bytes: Type.Integer(),
  duration_ms: Type.Integer(),
  hi_res: Type.Boolean(),
  is_dsd: Type.Boolean(),
  dsd_rate: Type.Union([Type.Integer(), Type.Null()]),
  supports_range: Type.Literal(true),
  stream_mode: QualitySchema,
});

const StreamResponseSchema = Type.Object({
  url: Type.String(),
  expires_at: Type.String({ format: 'date-time' }),
  track_id: Type.String({ format: 'uuid' }),
  asset: StreamAssetSchema,
});

const SourceResponseSchema = Type.Object({
  track_id: Type.String({ format: 'uuid' }),
  codec: Type.String(),
  container: Type.String(),
  channels: Type.Integer(),
  sample_rate: Type.Integer(),
  bit_depth: Type.Union([Type.Integer(), Type.Null()]),
  bitrate: Type.Union([Type.Integer(), Type.Null()]),
  dsd_rate: Type.Union([Type.Integer(), Type.Null()]),
  duration_ms: Type.Integer(),
  file_size: Type.Integer(),
  lossless: Type.Boolean(),
  hires: Type.Boolean(),
  stream_mode: QualitySchema,
  supports_range: Type.Literal(true),
});

function mapFormats(body?: { codec: string; container: string; mime_type?: string }[]) {
  return body?.map((format) => ({
    codec: format.codec,
    container: format.container,
    mimeType: format.mime_type,
  }));
}

export const streamingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post('/v1/tracks/:trackId/stream', {
    config: {
      rateLimit: {
        max: app.config.streamRateLimitMax,
        timeWindow: app.config.authRateLimitWindowMs,
      },
    },
    schema: {
      tags: ['Streaming'],
      summary: 'Issue a short-lived signed URL for the original (maximum) audio object; client quality hints are ignored',
      params: TrackIdParams,
      body: StreamBodySchema,
      response: {
        200: StreamResponseSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.streamingService.createStream(request.params.trackId, {
      quality: (request.body?.quality ?? 'maximum') as QualityPreset,
      supported_formats: mapFormats(request.body?.supported_formats),
    }));

  app.get('/v1/tracks/:trackId/source', {
    schema: {
      tags: ['Streaming'],
      summary: 'Describe the original (maximum) audio source without minting a URL; client quality hints are ignored',
      params: TrackIdParams,
      querystring: StreamQuerySchema,
      response: {
        200: SourceResponseSchema,
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
        409: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request) =>
    app.streamingService.getSource(request.params.trackId, {
      quality: (request.query.quality ?? 'maximum') as QualityPreset,
    }));

  app.get('/v1/tracks/:trackId/artwork', {
    schema: {
      tags: ['Streaming'],
      summary: 'Redirect to the public cover art URL for a published track',
      params: TrackIdParams,
      response: {
        302: Type.Null(),
        401: ErrorEnvelopeSchema,
        404: ErrorEnvelopeSchema,
      },
    },
    preHandler: app.authenticate,
  }, async (request, reply) => {
    const url = await app.streamingService.getArtworkUrl(request.params.trackId);
    return reply.redirect(url);
  });
};

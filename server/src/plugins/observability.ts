import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cacheControlForPath } from '../http/cacheControl.js';
import { applySecurityHeaders } from '../http/securityHeaders.js';
import { AppError } from '../errors/appError.js';
import { defaultMetrics, workerQueueGauges, type MetricsRegistry } from '../observability/metrics.js';

export function registerObservability(app: FastifyInstance, metrics: MetricsRegistry = defaultMetrics): void {
  if (!app.hasDecorator('metrics')) {
    app.decorate('metrics', metrics);
  }

  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { metricsStartedAt?: number }).metricsStartedAt = Date.now();
  });

  app.addHook('onSend', async (request, reply, payload) => {
    applySecurityHeaders(reply, app.config);
    const path = request.routeOptions.url ?? request.url.split('?')[0] ?? '/';
    const cache = cacheControlForPath(request.method, path, {
      catalogPublic: app.config.catalogPublic,
      authenticated: Boolean(request.authUser),
    });
    if (cache) reply.header('Cache-Control', cache);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    const started = (request as FastifyRequest & { metricsStartedAt?: number }).metricsStartedAt;
    const seconds = started ? (Date.now() - started) / 1000 : 0;
    const route = request.routeOptions.url ?? sanitizeLoosePath(request.url);
    metrics.observeHttp(request.method, route, reply.statusCode, seconds);

    if (route === '/v1/tracks/:trackId/stream' && reply.statusCode === 200) {
      const quality = typeof (request.body as { quality?: string } | undefined)?.quality === 'string'
        ? (request.body as { quality: string }).quality
        : 'auto';
      metrics.signedStream(quality);
    }
    if (route === '/v1/tracks/:trackId/stream' && reply.statusCode === 409) {
      metrics.streamUnavailable();
    }
    if (route === '/v1/admin/imports' && reply.statusCode === 201) metrics.upload('initiated');
    if (route.endsWith('/audio-uploads') && reply.statusCode === 201) metrics.upload('initiated');
    if (route.endsWith('/artwork-uploads') && reply.statusCode === 201) metrics.upload('initiated');
    if (route === '/v1/admin/uploads/:uploadId/complete' && reply.statusCode === 200) metrics.upload('completed');
    if (route === '/v1/admin/uploads/:uploadId/cancel' && reply.statusCode === 200) metrics.upload('cancelled');
    if (route === '/v1/admin/catalog/tracks/:id/publish' && reply.statusCode === 200) metrics.publish('publish');
    if (route === '/v1/admin/catalog/tracks/:id/unpublish' && reply.statusCode === 200) metrics.publish('unpublish');
  });

  app.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
    if (!app.config.metricsEnabled) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Not found.', request_id: request.id });
    }
    const token = app.config.metricsToken;
    if (token) {
      const header = request.headers.authorization;
      if (header !== `Bearer ${token}`) {
        return reply.status(401).send({ code: 'AUTH_UNAUTHORIZED', message: 'Authentication required.', request_id: request.id });
      }
    } else if (app.config.nodeEnv === 'production') {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Not found.', request_id: request.id });
    }
    reply.header('Cache-Control', 'no-store');
    reply.type('text/plain; version=0.0.4');
    const gauges = await workerQueueGauges(app.db).catch(() => ({
      worker_queue_depth: 0,
      worker_oldest_pending_age_seconds: 0,
    }));
    return metrics.render(gauges);
  });
}

export function recordAuthFailure(metrics: MetricsRegistry, error: unknown): void {
  if (error instanceof AppError) {
    metrics.authFailure(error.code);
  }
}

function sanitizeLoosePath(url: string): string {
  return (url.split('?')[0] ?? '/').slice(0, 120);
}

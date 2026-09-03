import type { FastifyInstance } from 'fastify';
import { CloudApiClient } from '@nnpm/api-client';
import { WebFavoritesApi } from '../../../web/src/platform/web/WebFavoritesApi';
import { WebHistoryApi } from '../../../web/src/platform/web/WebHistoryApi';
import { WebLibraryApi } from '../../../web/src/platform/web/WebLibraryApi';
import { WebPlaylistApi } from '../../../web/src/platform/web/WebPlaylistApi';
import { WebStreamingApi } from '../../../web/src/platform/streaming/WebStreamingApi';

export function createInjectCloudClient(app: FastifyInstance, token: string): CloudApiClient {
  return new CloudApiClient({
    baseUrl: 'http://127.0.0.1',
    getAccessToken: () => token,
    fetcher: async (input, init) => {
      const href = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const parsed = new URL(href, 'http://127.0.0.1');
      const headers = new Headers(init?.headers);
      const rawBody = init?.body;
      const payload = typeof rawBody === 'string' && rawBody.length > 0
        ? JSON.parse(rawBody)
        : undefined;
      const response = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        url: `${parsed.pathname}${parsed.search}`,
        headers: Object.fromEntries(headers.entries()),
        payload,
      });
      const resHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') resHeaders.set(key, value);
      }
      return new Response(response.statusCode === 204 ? null : response.body, {
        status: response.statusCode,
        headers: resHeaders,
      });
    },
  });
}

export function createWebDomainApis(app: FastifyInstance, token: string) {
  const cloud = createInjectCloudClient(app, token);
  return {
    playlists: new WebPlaylistApi(cloud),
    favorites: new WebFavoritesApi(cloud),
    history: new WebHistoryApi(cloud),
    library: new WebLibraryApi(cloud),
    streaming: new WebStreamingApi(cloud),
  };
}

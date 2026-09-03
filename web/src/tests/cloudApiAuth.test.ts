import { describe, expect, it } from 'vitest';
import { CloudApiClient, CloudApiError, isAuthSessionPath } from '../api/client';
import { jsonResponse } from './support/auth';

describe('CloudApiClient authentication', () => {
  it('attaches a Bearer access token', async () => {
    const captured: RequestInit[] = [];
    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => 'access-token',
      fetcher: (async (_input, init) => {
        captured.push(init ?? {});
        return jsonResponse({ ok: true });
      }) as typeof fetch,
    });

    await client.request('/v1/me');
    expect(new Headers(captured[0]?.headers).get('Authorization')).toBe('Bearer access-token');
  });

  it('single-flights refresh and retries a 401 once', async () => {
    let token: string | null = 'expired';
    let refreshStarts = 0;
    let inFlight: Promise<boolean> | null = null;
    const paths: string[] = [];
    const bodies: unknown[] = [];

    const onUnauthorized = () => {
      if (!inFlight) {
        refreshStarts += 1;
        inFlight = Promise.resolve().then(() => {
          token = 'fresh-token';
          return true;
        });
      }
      return inFlight;
    };

    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => token,
      onUnauthorized,
      fetcher: (async (input, init) => {
        const url = String(input);
        paths.push(url);
        bodies.push(init?.body);
        const auth = new Headers(init?.headers).get('Authorization');
        if (auth === 'Bearer expired') {
          return jsonResponse({
            code: 'AUTH_TOKEN_EXPIRED',
            message: 'Token expired.',
            request_id: 'r1',
          }, 401);
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch,
    });

    const [first, second] = await Promise.all([
      client.request('/v1/library/tracks', { method: 'POST', body: { id: 1 } }),
      client.request('/v1/library/stats', { method: 'POST', body: { id: 1 } }),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(refreshStarts).toBe(1);
    expect(paths.filter(path => path.endsWith('/v1/library/tracks'))).toHaveLength(2);
    expect(bodies.filter(body => body === JSON.stringify({ id: 1 }))).toHaveLength(4);
  });

  it('does not retry 403 responses', async () => {
    let unauthorized = 0;
    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => 'token',
      onUnauthorized: async () => {
        unauthorized += 1;
        return true;
      },
      fetcher: (async () => jsonResponse({
        code: 'AUTH_INVALID_ORIGIN',
        message: 'Request origin is not allowed.',
        request_id: 'r2',
      }, 403)) as typeof fetch,
    });

    await expect(client.request('/v1/me')).rejects.toMatchObject({ status: 403 });
    expect(unauthorized).toBe(0);
  });

  it('does not recurse into auth session endpoints', async () => {
    let unauthorized = 0;
    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => 'token',
      onUnauthorized: async () => {
        unauthorized += 1;
        return true;
      },
      fetcher: (async () => jsonResponse({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
        request_id: 'r3',
      }, 401)) as typeof fetch,
    });

    await expect(client.request('/v1/auth/login', {
      method: 'POST',
      body: { email: 'a@b.c', password: 'password1' },
    })).rejects.toBeInstanceOf(CloudApiError);
    await expect(client.request('/v1/auth/refresh', { method: 'POST' }))
      .rejects.toBeInstanceOf(CloudApiError);
    expect(unauthorized).toBe(0);
    expect(isAuthSessionPath('/v1/auth/logout')).toBe(true);
  });

  it('does not retry after a failed refresh', async () => {
    let fetches = 0;
    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => 'expired',
      onUnauthorized: async () => false,
      fetcher: (async () => {
        fetches += 1;
        return jsonResponse({
          code: 'AUTH_UNAUTHORIZED',
          message: 'Authentication required.',
          request_id: 'r4',
        }, 401);
      }) as typeof fetch,
    });

    await expect(client.request('/v1/me')).rejects.toMatchObject({ status: 401, code: 'AUTH_UNAUTHORIZED' });
    expect(fetches).toBe(1);
  });

  it('retries a recovered 401 only once', async () => {
    let fetches = 0;
    const client = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => 'token',
      onUnauthorized: async () => true,
      fetcher: (async () => {
        fetches += 1;
        return jsonResponse({
          code: 'AUTH_UNAUTHORIZED',
          message: 'Authentication required.',
          request_id: 'r5',
        }, 401);
      }) as typeof fetch,
    });

    await expect(client.request('/v1/library/tracks')).rejects.toMatchObject({ status: 401 });
    expect(fetches).toBe(2);
  });

  it('honors AbortSignal before and after refresh', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new CloudApiClient({
      baseUrl: '/api',
      fetcher: (async () => jsonResponse({ ok: true })) as typeof fetch,
    });
    await expect(client.request('/v1/me', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });

    let unauthorized = 0;
    const live = new AbortController();
    const retryClient = new CloudApiClient({
      baseUrl: '/api',
      getAccessToken: () => 'expired',
      onUnauthorized: async () => {
        unauthorized += 1;
        live.abort();
        return true;
      },
      fetcher: (async () => jsonResponse({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'expired',
        request_id: 'r6',
      }, 401)) as typeof fetch,
    });
    await expect(retryClient.request('/v1/me', { signal: live.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(unauthorized).toBe(1);
  });
});

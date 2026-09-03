import { describe, expect, it } from 'vitest';
import { CloudApiClient } from '../api/client';
import { WebAccountApi } from '../platform/web/WebAccountApi';
import { jsonResponse } from './support/auth';

describe('WebAccountApi', () => {
  it('maps register/login/refresh/me payloads from the backend contract', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const sessionBody = {
      access_token: 'access',
      token_type: 'Bearer',
      expires_in: 900,
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'bang@example.com',
        display_name: 'Bang',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    };
    const client = new CloudApiClient({
      baseUrl: '/api',
      fetcher: (async (input, init) => {
        captured.push({ url: String(input), init });
        const url = String(input);
        if (url.endsWith('/v1/auth/logout')) return new Response(null, { status: 204 });
        if (url.endsWith('/v1/me') && init?.method === 'PATCH') {
          return jsonResponse({ ...sessionBody.user, display_name: 'Updated' });
        }
        if (url.endsWith('/v1/me')) return jsonResponse(sessionBody.user);
        return jsonResponse(sessionBody, url.endsWith('/v1/auth/register') ? 201 : 200);
      }) as typeof fetch,
    });
    const api = new WebAccountApi(client);

    const registered = await api.register({
      email: 'Bang@Example.COM',
      password: 'correct-horse',
      displayName: 'Bang',
    });
    expect(registered.user.displayName).toBe('Bang');
    expect(JSON.parse(String(captured[0]?.init?.body))).toEqual({
      email: 'Bang@Example.COM',
      password: 'correct-horse',
      display_name: 'Bang',
    });

    const login = await api.login({ email: 'bang@example.com', password: 'correct-horse' });
    expect(login.accessToken).toBe('access');

    const refreshed = await api.refresh();
    expect(refreshed.expiresIn).toBe(900);

    await api.logout();
    expect(captured.some(entry => entry.url.endsWith('/v1/auth/logout'))).toBe(true);

    expect(await api.getProfile()).toMatchObject({ displayName: 'Bang', email: 'bang@example.com' });
    expect(await api.updateProfile({ displayName: 'Updated' })).toMatchObject({ displayName: 'Updated' });
    const patch = captured.find(entry => entry.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ display_name: 'Updated' });
  });
});

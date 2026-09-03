import { describe, expect, it } from 'vitest';
import { CloudApiClient, CloudApiError } from '../api/client';

describe('CloudApiClient', () => {
  it('normalizes URLs and sends authenticated JSON requests', async () => {
    const capturedRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    let callCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      callCount += 1;
      capturedRequests.push({ input, init });
      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    const client = new CloudApiClient({
      baseUrl: 'https://api.example.test/',
      fetcher,
      getAccessToken: () => 'access-token',
    });

    await expect(client.request<{ ok: boolean }>('v1/test', {
      method: 'POST',
      body: { name: 'Nghe Nhac Pro Max' },
    })).resolves.toEqual({ ok: true });

    expect(callCount).toBe(1);
    const capturedRequest = capturedRequests[0];
    if (!capturedRequest) throw new Error('Expected a captured cloud request.');
    const options = capturedRequest.init;
    const headers = new Headers(options?.headers);
    expect(capturedRequest.input).toBe('https://api.example.test/v1/test');
    expect(options?.credentials).toBe('include');
    expect(options?.body).toBe(JSON.stringify({ name: 'Nghe Nhac Pro Max' }));
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('returns a typed error for unsuccessful responses', async () => {
    const client = new CloudApiClient({
      baseUrl: '/api',
      fetcher: (async () => new Response(
        JSON.stringify({ message: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch,
    });

    const request = client.request('/v1/me');
    await expect(request).rejects.toBeInstanceOf(CloudApiError);
    await expect(request).rejects.toMatchObject({
      message: 'Unauthorized',
      status: 401,
    });
  });
});

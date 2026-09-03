export interface CloudApiClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  getAccessToken?: () => Promise<string | null> | string | null;
  onUnauthorized?: () => Promise<boolean>;
}

export interface CloudRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export class CloudApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'CloudApiError';
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

function pathName(value: string): string {
  const path = normalizePath(value);
  const query = path.indexOf('?');
  return query === -1 ? path : path.slice(0, query);
}

const AUTH_SESSION_PATHS = new Set([
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
  '/v1/auth/logout',
]);

export function isAuthSessionPath(path: string): boolean {
  return AUTH_SESSION_PATHS.has(pathName(path));
}

function errorCodeFromPayload(payload: unknown): string | undefined {
  if (typeof payload === 'object' && payload !== null && 'code' in payload) {
    const code = (payload as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function errorMessageFromPayload(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof payload === 'string') {
    const text = payload.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 180) return text;
  }
  return `Cloud request failed with status ${status}.`;
}

export class CloudApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly getAccessToken?: CloudApiClientOptions['getAccessToken'];
  private readonly onUnauthorized?: CloudApiClientOptions['onUnauthorized'];

  constructor(options: CloudApiClientOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  async request<T>(path: string, options: CloudRequestOptions = {}): Promise<T> {
    return this.requestInternal(path, options, false);
  }

  private async requestInternal<T>(
    path: string,
    options: CloudRequestOptions,
    isRetry: boolean,
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw abortError(options.signal);
    }

    const headers = new Headers(options.headers);
    const skipRefresh = isAuthSessionPath(path);
    if (!skipRefresh) {
      const token = await this.getAccessToken?.();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const response = await this.fetcher(`${this.baseUrl}${normalizePath(path)}`, {
      ...options,
      body,
      credentials: options.credentials ?? 'include',
      headers,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = response.status === 204
      ? undefined
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
      const error = new CloudApiError(
        errorMessageFromPayload(payload, response.status),
        response.status,
        payload,
        errorCodeFromPayload(payload),
      );

      const canRefresh = response.status === 401
        && !isRetry
        && !skipRefresh
        && this.onUnauthorized != null;

      if (canRefresh) {
        const recovered = await this.onUnauthorized();
        if (recovered) {
          if (options.signal?.aborted) {
            throw abortError(options.signal);
          }
          return this.requestInternal(path, options, true);
        }
      }

      throw error;
    }

    return payload as T;
  }
}

function abortError(signal: AbortSignal): DOMException {
  if (signal.reason instanceof DOMException) return signal.reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

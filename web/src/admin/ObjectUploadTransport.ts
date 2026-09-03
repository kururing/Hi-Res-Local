import type { PresignedUpload } from '../platform/admin/types';

export interface ObjectUploadProgress {
  bytesSent: number;
  totalBytes: number;
  percent: number;
}

export interface ObjectUploadRequest {
  upload: PresignedUpload;
  body: Blob;
  signal?: AbortSignal;
  onProgress?: (progress: ObjectUploadProgress) => void;
  fetcher?: typeof fetch;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export class ObjectUploadTransport {
  constructor(private readonly fetcher: typeof fetch = fetch.bind(globalThis)) {}

  async put(request: ObjectUploadRequest): Promise<void> {
    if (request.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.upload.headers)) {
      headers.set(key, value);
    }

    const attempt = async (): Promise<Response> => {
      const xhrFallback = typeof XMLHttpRequest !== 'undefined' && request.onProgress;
      if (xhrFallback) {
        return putWithProgress(request.upload.url, headers, request.body, request.signal, request.onProgress);
      }
      return (request.fetcher ?? this.fetcher)(request.upload.url, {
        method: 'PUT',
        headers,
        body: request.body,
        credentials: 'omit',
        mode: 'cors',
        signal: request.signal,
      });
    };

    let response = await attempt();
    if (!response.ok && RETRYABLE.has(response.status) && !request.signal?.aborted) {
      response = await attempt();
    }
    if (!response.ok) {
      throw new Error(`Object upload failed with status ${response.status}.`);
    }
  }
}

function putWithProgress(
  url: string,
  headers: Headers,
  body: Blob,
  signal: AbortSignal | undefined,
  onProgress: ((progress: ObjectUploadProgress) => void) | undefined,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.withCredentials = false;
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      onProgress?.({
        bytesSent: event.loaded,
        totalBytes: event.total,
        percent: event.total ? Math.round((event.loaded / event.total) * 100) : 0,
      });
    };
    xhr.onload = () => resolve(new Response(null, { status: xhr.status }));
    xhr.onerror = () => reject(new TypeError('Object upload network error.'));
    xhr.onabort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

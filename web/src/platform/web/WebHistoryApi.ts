import type { CloudApiClient } from '../../api/client';
import type { PlayHistoryEntry } from '../../types/ipc';
import type { HistoryApi, HistoryListOptions, RecordPlayInput } from '../contracts';
import { sanitizeCloudTrack } from './WebLibraryApi';

function sanitizeHistoryEntry(entry: PlayHistoryEntry): PlayHistoryEntry {
  return {
    ...entry,
    track: entry.track ? sanitizeCloudTrack(entry.track) : null,
  };
}

function historyQuery(options?: HistoryListOptions): string {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  if (options?.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  return query ? `/v1/history?${query}` : '/v1/history';
}

/**
 * Browser cloud runtime. History reads and writes go through CloudApiClient.
 * `client_request_id` is forwarded as an Idempotency-Key so retries can be
 * made safe later without changing playback session logic.
 */
export class WebHistoryApi implements HistoryApi {
  constructor(private readonly cloud: CloudApiClient) {}

  async record(input: RecordPlayInput): Promise<PlayHistoryEntry> {
    const headers = new Headers();
    if (input.client_request_id) {
      headers.set('Idempotency-Key', input.client_request_id);
    }

    const payload = await this.cloud.request<PlayHistoryEntry>('/v1/history', {
      method: 'POST',
      headers,
      body: {
        track_id: input.track_id,
        completed_duration_ms: input.completed_duration_ms,
        fully_played: input.fully_played,
        ...(input.client_request_id ? { client_request_id: input.client_request_id } : {}),
      },
    });
    return sanitizeHistoryEntry(payload);
  }

  async list(options?: HistoryListOptions): Promise<PlayHistoryEntry[]> {
    const payload = await this.cloud.request<PlayHistoryEntry[]>(historyQuery(options));
    if (!Array.isArray(payload)) {
      throw new Error('Cloud history response was not an array.');
    }
    return payload.map(sanitizeHistoryEntry);
  }

  async clear(): Promise<number> {
    const result = await this.cloud.request<number | undefined>('/v1/history', {
      method: 'DELETE',
    });
    return result ?? 0;
  }
}

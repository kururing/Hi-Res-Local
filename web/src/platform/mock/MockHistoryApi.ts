import type { PlayHistoryEntry } from '../../types/ipc';
import type { HistoryApi, HistoryListOptions, RecordPlayInput } from '../contracts';
import type { MockDataStore } from './MockDataStore';

/** Direct in-memory history adapter. Track payloads come from the shared store. */
export class MockHistoryApi implements HistoryApi {
  constructor(private readonly store: MockDataStore) {}

  record(input: RecordPlayInput): Promise<PlayHistoryEntry> {
    return Promise.resolve(this.store.recordPlay({
      track_id: input.track_id,
      completed_duration_ms: input.completed_duration_ms,
      fully_played: input.fully_played,
    }));
  }

  list(options?: HistoryListOptions): Promise<PlayHistoryEntry[]> {
    return Promise.resolve(this.store.listHistory(options?.limit, options?.offset));
  }

  clear(): Promise<number> {
    return Promise.resolve(this.store.clearHistory());
  }
}

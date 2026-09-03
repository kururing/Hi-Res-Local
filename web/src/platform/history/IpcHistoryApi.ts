import type { PlayHistoryEntry } from '../../types/ipc';
import type {
  HistoryApi,
  HistoryListOptions,
  PlatformCommandGateway,
  RecordPlayInput,
} from '../contracts';

/** IPC-backed history adapter for the Tauri desktop runtime. */
export class IpcHistoryApi implements HistoryApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  record(input: RecordPlayInput): Promise<PlayHistoryEntry> {
    return this.commands.invoke('record_play', {
      input: {
        track_id: input.track_id,
        completed_duration_ms: input.completed_duration_ms,
        fully_played: input.fully_played,
      },
    });
  }

  list(options?: HistoryListOptions): Promise<PlayHistoryEntry[]> {
    return this.commands.invoke('get_play_history', options);
  }

  clear(): Promise<number> {
    return this.commands.invoke('clear_play_history');
  }
}

export class TauriHistoryApi extends IpcHistoryApi {}

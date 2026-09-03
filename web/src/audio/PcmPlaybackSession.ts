export interface PcmPlaybackHandlers {
  onEnded(): void;
  onError(error: Error): void;
  onPosition(positionSeconds: number, durationSeconds: number): void;
}

export interface PcmPlayRequest {
  url: string;
  getFreshUrl?: () => Promise<string>;
  startSeconds: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitDepth: number | null;
  container: string;
  signal?: AbortSignal;
}

export interface PcmPlaybackSession {
  play(request: PcmPlayRequest): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionSeconds: number, url: string): Promise<void>;
  stop(): Promise<void>;
  setVolume(volume: number, muted: boolean): void;
  needsSourceUrl(): boolean;
  getDuration(): number;
  getPosition(): number;
  getOutputSampleRate(): number;
  getOutputBitDepth(): number;
}

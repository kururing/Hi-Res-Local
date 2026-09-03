import type { BrowserMediaElement } from '../../audio/browserMedia';

type Listener = EventListenerOrEventListenerObject;

export class FakeMediaElement implements BrowserMediaElement {
  src = '';
  preload = 'metadata';
  playsInline = true;
  currentTime = 0;
  private volumeValue = 1;
  private mutedValue = false;
  ended = false;
  error: { code: number; message?: string } | null = null;
  paused = true;
  autoReady = true;
  readyDuration = 180;
  playError: Error | null = null;
  listenerCounts = new Map<string, number>();

  private durationValue = Number.NaN;
  private listeners = new Map<string, Set<Listener>>();

  get volume(): number {
    return this.volumeValue;
  }

  set volume(value: number) {
    if (this.volumeValue === value) return;
    this.volumeValue = value;
    this.dispatch('volumechange');
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    if (this.mutedValue === value) return;
    this.mutedValue = value;
    this.dispatch('volumechange');
  }

  get duration(): number {
    return this.durationValue;
  }

  setDuration(value: number): void {
    this.durationValue = value;
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
    this.listenerCounts.set(type, set.size);
  }

  removeEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type);
    if (!set) return;
    set.delete(listener);
    this.listenerCounts.set(type, set.size);
  }

  dispatch(type: string): void {
    const event = { type, target: this } as unknown as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }

  load(): void {
    this.paused = true;
    this.ended = false;
    this.error = null;
    this.dispatch('loadstart');
    if (this.autoReady && this.src) {
      this.durationValue = this.readyDuration;
      this.dispatch('loadedmetadata');
      this.dispatch('canplay');
      this.dispatch('durationchange');
    }
  }

  async play(): Promise<void> {
    if (this.playError) return Promise.reject(this.playError);
    this.paused = false;
    this.ended = false;
    this.dispatch('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.dispatch('pause');
  }

  fail(code = 2): void {
    this.error = { code, message: `media error ${code}` };
    this.dispatch('error');
  }

  finish(): void {
    this.ended = true;
    this.paused = true;
    this.currentTime = Number.isFinite(this.durationValue) ? this.durationValue : this.currentTime;
    this.dispatch('ended');
  }
}

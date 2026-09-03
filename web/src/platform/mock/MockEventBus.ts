type EventListener<T> = (payload: T) => void;

/**
 * In-memory typed event bus for mock preview. Domain APIs emit library/scan
 * events here. Playback events stay on MockAudioEngine — this bus must not
 * bridge to the audio engine.
 */
export class MockEventBus {
  private readonly listeners = new Map<string, Set<EventListener<unknown>>>();

  subscribe<T>(event: string, listener: (payload: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const typed = listener as EventListener<unknown>;
    set.add(typed);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(typed);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<T>(event: string, payload: T): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[MockEventBus] Listener for "${event}" failed:`, error);
      }
    }
  }

  clear(): void {
    for (const set of this.listeners.values()) {
      set.clear();
    }
    this.listeners.clear();
  }
}

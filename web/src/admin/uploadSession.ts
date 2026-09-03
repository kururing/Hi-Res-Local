export class AdminUploadSession {
  private controller: AbortController | null = null;
  private generation = 0;
  private persistedUrl: string | null = null;

  start(): { signal: AbortSignal; generation: number } {
    this.abort();
    this.controller = new AbortController();
    this.generation += 1;
    this.persistedUrl = null;
    return { signal: this.controller.signal, generation: this.generation };
  }

  rememberUrl(_url: string): void {
    this.persistedUrl = null;
  }

  currentGeneration(): number {
    return this.generation;
  }

  hasPersistedUrl(): boolean {
    return this.persistedUrl != null;
  }

  abort(): void {
    this.controller?.abort();
    this.controller = null;
  }
}

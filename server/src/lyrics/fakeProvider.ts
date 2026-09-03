import type { LyricsProvider, LyricsProviderRequest, LyricsProviderResult } from './provider.js';

export class FakeLyricsProvider implements LyricsProvider {
  readonly calls: LyricsProviderRequest[] = [];
  nextResult: LyricsProviderResult | null = null;
  nextError: Error | null = null;
  delayMs = 0;
  inFlight = 0;
  maxInFlight = 0;

  async resolve(request: LyricsProviderRequest): Promise<LyricsProviderResult | null> {
    this.calls.push({ ...request });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      if (this.nextError) throw this.nextError;
      return this.nextResult;
    } finally {
      this.inFlight -= 1;
    }
  }

  reset(): void {
    this.calls.length = 0;
    this.nextResult = null;
    this.nextError = null;
    this.delayMs = 0;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }
}

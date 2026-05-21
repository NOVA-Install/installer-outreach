export class RateLimiter {
  private nextAvailable = 0;
  private readonly minInterval: number;

  constructor(requestsPerSecond: number) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    // Reserve the next slot atomically
    const mySlot = Math.max(now, this.nextAvailable);
    this.nextAvailable = mySlot + this.minInterval;

    const wait = mySlot - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

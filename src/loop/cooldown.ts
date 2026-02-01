/**
 * Cooldown Tracker
 *
 * Enforces minimum time gap between supervisor calls to prevent feedback loops.
 * This is NOT debounce - cooldown starts AFTER an action, not during idle.
 */

export class Cooldown {
  private lastActionTime: number = 0;
  private readonly minMs: number;

  /**
   * Create a cooldown tracker
   * @param minMs Minimum milliseconds between actions (default: 3000)
   */
  constructor(minMs: number = 3000) {
    if (minMs < 0) {
      throw new Error('minMs must be non-negative');
    }
    this.minMs = minMs;
  }

  /**
   * Check if enough time has passed since last action
   * @returns true if cooldown period has elapsed
   */
  canProceed(): boolean {
    const now = Date.now();
    return now - this.lastActionTime >= this.minMs;
  }

  /**
   * Mark an action as taken, starting the cooldown period
   */
  mark(): void {
    this.lastActionTime = Date.now();
  }

  /**
   * Get remaining cooldown time in milliseconds
   * @returns 0 if cooldown elapsed, otherwise remaining ms
   */
  timeRemaining(): number {
    const elapsed = Date.now() - this.lastActionTime;
    return Math.max(0, this.minMs - elapsed);
  }

  /**
   * Wait for cooldown to complete
   * @returns Promise that resolves when cooldown is over
   */
  async wait(): Promise<void> {
    const remaining = this.timeRemaining();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  /**
   * Reset the cooldown (as if no action was ever taken)
   */
  reset(): void {
    this.lastActionTime = 0;
  }

  /**
   * Get the configured minimum cooldown period
   */
  get minCooldownMs(): number {
    return this.minMs;
  }
}

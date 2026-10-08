export const BUDGET_EXCEEDED = Symbol("budget-exceeded");

/**
 * Cola secuencial por dominio: una petición cada vez, con un mínimo de
 * `minIntervalMs` entre inicios y un tope de peticiones de red.
 */
export class DomainLimiter {
  private minIntervalMs: number;
  private readonly budget: number;
  private used = 0;
  private lastStart = Number.NEGATIVE_INFINITY;
  private tail: Promise<void> = Promise.resolve();

  constructor(opts: { minIntervalMs: number; budget: number }) {
    this.minIntervalMs = opts.minIntervalMs;
    this.budget = opts.budget;
  }

  get remaining(): number {
    return this.budget - this.used;
  }

  get consumed(): number {
    return this.used;
  }

  setMinInterval(ms: number): void {
    this.minIntervalMs = Math.max(this.minIntervalMs, ms);
  }

  schedule<T>(task: () => Promise<T>): Promise<T | typeof BUDGET_EXCEEDED> {
    const run = async (): Promise<T | typeof BUDGET_EXCEEDED> => {
      if (this.used >= this.budget) return BUDGET_EXCEEDED;
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastStart = Date.now();
      this.used++;
      return task();
    };
    const result = this.tail.then(run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

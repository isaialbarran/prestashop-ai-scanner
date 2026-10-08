import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGET_EXCEEDED, DomainLimiter } from "./limiter";

describe("DomainLimiter", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it("separa el inicio de cada petición al menos el intervalo mínimo", async () => {
    const limiter = new DomainLimiter({ minIntervalMs: 1000, budget: 10 });
    const starts: number[] = [];
    const task = async () => void starts.push(Date.now());

    const all = Promise.all([limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)]);
    await vi.runAllTimersAsync();
    await all;

    expect(starts).toEqual([0, 1000, 2000]);
  });

  it("no lanza dos peticiones a la vez aunque la anterior tarde más que el intervalo", async () => {
    const limiter = new DomainLimiter({ minIntervalMs: 1000, budget: 10 });
    let running = 0;
    let maxRunning = 0;
    const slow = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 3000));
      running--;
    };

    const all = Promise.all([limiter.schedule(slow), limiter.schedule(slow)]);
    await vi.runAllTimersAsync();
    await all;

    expect(maxRunning).toBe(1);
  });

  it("devuelve BUDGET_EXCEEDED al agotar el presupuesto sin ejecutar la tarea", async () => {
    const limiter = new DomainLimiter({ minIntervalMs: 0, budget: 2 });
    const task = vi.fn(async () => "ok");

    const results = Promise.all([limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)]);
    await vi.runAllTimersAsync();

    expect(await results).toEqual(["ok", "ok", BUDGET_EXCEEDED]);
    expect(task).toHaveBeenCalledTimes(2);
    expect(limiter.remaining).toBe(0);
  });

  it("sigue atendiendo la cola si una tarea falla", async () => {
    const limiter = new DomainLimiter({ minIntervalMs: 0, budget: 5 });
    const failing = limiter.schedule(async () => {
      throw new Error("boom");
    });
    const next = limiter.schedule(async () => "ok");
    await vi.runAllTimersAsync();

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("permite subir el intervalo con el Crawl-delay", async () => {
    const limiter = new DomainLimiter({ minIntervalMs: 1000, budget: 10 });
    limiter.setMinInterval(5000);
    const starts: number[] = [];
    const task = async () => void starts.push(Date.now());

    const all = Promise.all([limiter.schedule(task), limiter.schedule(task)]);
    await vi.runAllTimersAsync();
    await all;

    expect(starts).toEqual([0, 5000]);
  });
});

import { describe, expect, it } from "vitest";
import { BudgetExceededError, CostLedger, costUsd, toEur } from "./cost";
import type { LlmCall, Usage } from "./types";

const usage = (over: Partial<Usage> = {}): Usage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  searchCalls: 0,
  ...over,
});

const call = (costUsd: number, over: Partial<LlmCall> = {}): LlmCall => ({
  id: "c",
  purpose: "visibility",
  provider: "openai",
  model: "chat-latest",
  inputHash: "h",
  startedAt: "2026-10-08T00:00:00.000Z",
  latencyMs: 1000,
  usage: usage(),
  costUsd,
  fromCache: false,
  error: null,
  response: null,
  ...over,
});

describe("costUsd", () => {
  it("cobra tokens de entrada, de caché y de salida, más cada búsqueda", () => {
    // 10k entrada (2k en caché) a 5/0,5 $ y 1k salida a 30 $ por 1M, más 2 búsquedas a 10 $/1k.
    const c = costUsd("openai", "chat-latest", usage({ inputTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 1_000, searchCalls: 2 }));
    expect(c).toBeCloseTo(0.04 + 0.001 + 0.03 + 0.02, 6);
  });

  it("usa la tarifa de búsqueda de Perplexity", () => {
    expect(costUsd("perplexity", "perplexity/sonar", usage({ searchCalls: 1 }))).toBeCloseTo(0.0025, 6);
  });

  it("falla con un modelo sin precio", () => {
    expect(() => costUsd("openai", "modelo-inventado", usage())).toThrow(/config\/models/);
  });
});

describe("CostLedger", () => {
  it("corta al pasar del presupuesto", () => {
    const ledger = new CostLedger(2);
    ledger.add(call(1));
    expect(() => ledger.add(call(1.5))).toThrow(BudgetExceededError);
  });

  it("no cuenta la caché como gasto pero sí en el coste del informe", () => {
    const ledger = new CostLedger(0.5);
    ledger.add(call(3, { fromCache: true }));
    expect(ledger.spentEur()).toBe(0);
    expect(ledger.reportCostUsd()).toBe(3);
  });

  it("agrupa por propósito y convierte a euros con el tipo del BCE", () => {
    const ledger = new CostLedger(10);
    ledger.add(call(0.1));
    ledger.add(call(0.02, { purpose: "detection" }));
    expect(ledger.byPurpose().visibility).toEqual({ calls: 1, costUsd: 0.1 });
    expect(toEur(1.1177)).toBeCloseTo(1, 6);
  });
});

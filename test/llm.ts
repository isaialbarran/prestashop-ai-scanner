import type { Provider } from "../config/models";
import type { CostLedger } from "../src/llm/cost";
import type { Llm, LlmCall, SearchAnswer, StructuredRequest } from "../src/llm/types";

/** Doble de Llm para tests: respuestas programadas por propósito o por proveedor, sin red ni coste. */
export function fakeLlm(
  handlers: {
    structured?: (req: StructuredRequest<unknown>) => unknown;
    search?: (provider: Provider, query: string) => Partial<SearchAnswer>;
  },
  ledger?: CostLedger,
): Llm & { calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  const record = (purpose: LlmCall["purpose"], provider: Provider, model: string): LlmCall => {
    const call: LlmCall = {
      id: `call-${calls.length + 1}`,
      purpose,
      provider,
      model,
      inputHash: `hash-${calls.length + 1}`,
      startedAt: "2026-10-08T00:00:00.000Z",
      latencyMs: 100,
      usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, reasoningTokens: 0, searchCalls: purpose === "visibility" ? 1 : 0 },
      costUsd: 0.001,
      fromCache: false,
      error: null,
      response: null,
    };
    calls.push(call);
    ledger?.add(call);
    return call;
  };
  return {
    calls,
    async structured<T>(req: StructuredRequest<T>) {
      if (!handlers.structured) throw new Error(`structured no programado (${req.purpose})`);
      return { data: req.schema.parse(handlers.structured(req as StructuredRequest<unknown>)), call: record(req.purpose, "openai", req.model) };
    },
    async search(req) {
      if (!handlers.search) throw new Error("search no programado");
      const answer: SearchAnswer = {
        provider: req.provider,
        model: req.model,
        text: "",
        cited: [],
        consulted: [],
        searchQueries: [],
        citationMode: "annotations",
        ...handlers.search(req.provider, req.query),
      };
      return { answer, call: record("visibility", req.provider, req.model) };
    },
  };
}

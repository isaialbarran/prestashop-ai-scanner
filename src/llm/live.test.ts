import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fixture } from "../../test/fixtures";
import { createMemoryLlmCache } from "./cache-memory";
import { CostLedger } from "./cost";
import { createLiveLlm, createLlmPool } from "./live";

const searchResponse = () => JSON.parse(fixture("llm/openai-search.json"));
const structuredResponse = (json: unknown) => ({
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(json), annotations: [] }] }],
  usage: { input_tokens: 2000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 10 } },
});

function stubOpenAI(respond: (body: Record<string, unknown>) => unknown) {
  const create = vi.fn(async (body: Record<string, unknown>) => respond(body));
  return { client: { responses: { create } } as unknown as OpenAI, create };
}

describe("createLiveLlm", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("cachea por petición: la segunda llamada no se paga pero conserva su coste", async () => {
    const { client, create } = stubOpenAI(() => searchResponse());
    const ledger = new CostLedger(2);
    const llm = createLiveLlm({ ledger, cache: createMemoryLlmCache(), openai: client });

    const first = await llm.search({ provider: "openai", model: "chat-latest", query: "mejor freidora" });
    const second = await llm.search({ provider: "openai", model: "chat-latest", query: "mejor freidora" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(second.call.fromCache).toBe(true);
    expect(second.answer.cited).toEqual(first.answer.cited);
    expect(ledger.spentEur()).toBeCloseTo(ledger.reportCostUsd() / 2 / 1.1177, 6);
  });

  it("con freshPurposes no lee la caché para esos propósitos, pero guarda la respuesta nueva", async () => {
    const { client, create } = stubOpenAI(() => searchResponse());
    const cache = createMemoryLlmCache();
    await createLiveLlm({ ledger: new CostLedger(2), cache, openai: client }).search({ provider: "openai", model: "chat-latest", query: "q" });
    const fresh = createLiveLlm({ ledger: new CostLedger(2), cache, openai: client, freshPurposes: ["visibility"] });
    const { call } = await fresh.search({ provider: "openai", model: "chat-latest", query: "q" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(call.fromCache).toBe(false);
    expect(cache.size()).toBe(1);
  });

  it("un pool comparte la cola de Perplexity entre informes y cada ledger recibe sus llamadas", async () => {
    const body = fixture("llm/perplexity-agent.json");
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      return new Response(body, { status: 200 });
    });
    const pool = createLlmPool({ fetchImpl, perplexityMinIntervalMs: 50, retryBaseMs: 1 });
    const [a, b] = [new CostLedger(2), new CostLedger(2)];
    await Promise.all([
      pool.forLedger(a).search({ provider: "perplexity", model: "perplexity/sonar", query: "uno" }),
      pool.forLedger(b).search({ provider: "perplexity", model: "perplexity/sonar", query: "dos" }),
    ]);
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(45);
  });

  it("valida la salida estructurada con zod y usa esfuerzo bajo en el modelo barato", async () => {
    const { client, create } = stubOpenAI(() => structuredResponse({ mentioned: true, quote: "Tienda Test" }));
    const llm = createLiveLlm({ ledger: new CostLedger(2), openai: client });
    const { data, call } = await llm.structured({
      purpose: "detection",
      model: "gpt-6-luna",
      name: "m",
      system: "s",
      user: "u",
      schema: z.object({ mentioned: z.boolean(), quote: z.string().nullable() }),
    });
    expect(data).toEqual({ mentioned: true, quote: "Tienda Test" });
    expect(call.usage).toMatchObject({ inputTokens: 2000, outputTokens: 50, reasoningTokens: 10 });
    expect(create.mock.calls[0]![0]).toMatchObject({ reasoning: { effort: "low" }, text: { format: { type: "json_schema" } } });
  });

  it("registra en el ledger las llamadas que fallan, con coste cero", async () => {
    const { client } = stubOpenAI(() => {
      throw new Error("500 server_is_overloaded");
    });
    const ledger = new CostLedger(2);
    const llm = createLiveLlm({ ledger, openai: client });
    await expect(llm.search({ provider: "openai", model: "chat-latest", query: "x" })).rejects.toThrow(/overloaded/);
    expect(ledger.calls).toHaveLength(1);
    expect(ledger.calls[0]).toMatchObject({ error: "500 server_is_overloaded", costUsd: 0 });
  });

  it("reintenta Perplexity tras un 429 y usa el coste que informa la API", async () => {
    const body = fixture("llm/perplexity-agent.json");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }));
    const ledger = new CostLedger(2);
    const llm = createLiveLlm({ ledger, fetchImpl, perplexityMinIntervalMs: 0, retryBaseMs: 1 });

    const { answer, call } = await llm.search({ provider: "perplexity", model: "perplexity/sonar", query: "dónde comprar" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ preset: "fast", model: "perplexity/sonar", tools: [{ type: "web_search", user_location: { country: "ES" } }] });
    expect(fetchImpl.mock.calls[0]![1].headers.authorization).toBe("Bearer pplx-test");
    expect(answer.citationMode).toBe("markers");
    expect(call.costUsd).toBe(0.003725);
  });

  it("no reintenta errores 4xx que no son 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad key", { status: 401 }));
    const llm = createLiveLlm({ ledger: new CostLedger(2), fetchImpl, perplexityMinIntervalMs: 0, retryBaseMs: 1 });
    await expect(llm.search({ provider: "perplexity", model: "perplexity/sonar", query: "x" })).rejects.toThrow(/Perplexity 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

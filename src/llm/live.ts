import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import pLimit from "p-limit";
import { LLM_LIMITS, MODELS, type Provider } from "../../config/models";
import { loadEnv } from "../env";
import { BUDGET_EXCEEDED, DomainLimiter } from "../fetch/limiter";
import { costUsd, type CostLedger } from "./cost";
import { openAISearchBody, openAIText, openAIUsage, parseOpenAISearch } from "./openai";
import { PERPLEXITY_ENDPOINT, parsePerplexity, perplexityBody, perplexityUsage } from "./perplexity";
import type { Llm, LlmCall, Purpose, SearchAnswer, Usage } from "./types";

interface CachedResponse {
  response: unknown;
  latencyMs: number;
  startedAt: string;
}

/** Caché de desarrollo por hash de la petición (CLAUDE.md: no pagar dos veces). */
export interface LlmCache {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, value: CachedResponse): Promise<void>;
}

export function createLlmDiskCache(dir = path.join(process.cwd(), ".cache", "llm")): LlmCache {
  const file = (key: string) => path.join(dir, key.slice(0, 2), `${key}.json`);
  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(file(key), "utf8")) as CachedResponse;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), JSON.stringify(value));
    },
  };
}

export interface LiveLlmOptions {
  ledger: CostLedger;
  cache?: LlmCache | null;
  openai?: OpenAI;
  fetchImpl?: typeof fetch;
  /** Para tests: intervalo entre peticiones a Perplexity y base del reintento exponencial. */
  perplexityMinIntervalMs?: number;
  retryBaseMs?: number;
}

const ZERO: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, searchCalls: 0 };

export function createLiveLlm(opts: LiveLlmOptions): Llm {
  let client = opts.openai ?? null;
  const openai = () =>
    (client ??= new OpenAI({
      apiKey: loadEnv(["OPENAI_API_KEY"]).OPENAI_API_KEY,
      timeout: LLM_LIMITS.timeoutMs,
      maxRetries: 2,
    }));
  const openaiSlots = pLimit(LLM_LIMITS.openaiConcurrency);
  const perplexityQueue = new DomainLimiter({
    minIntervalMs: opts.perplexityMinIntervalMs ?? LLM_LIMITS.perplexityMinIntervalMs,
    budget: Number.MAX_SAFE_INTEGER,
  });
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const fetchImpl = opts.fetchImpl ?? fetch;

  /** Ejecuta (o recupera de caché) una petición y registra la llamada en el ledger, también si falla. */
  async function run(
    purpose: Purpose,
    provider: Provider,
    model: string,
    body: unknown,
    send: () => Promise<unknown>,
    measure: (response: unknown) => { usage: Usage; costUsd: number },
  ): Promise<{ response: unknown; call: LlmCall }> {
    const inputHash = createHash("sha256").update(JSON.stringify({ provider, body })).digest("hex");
    const base = { id: randomUUID(), purpose, provider, model, inputHash };
    const hit = await opts.cache?.get(inputHash);
    if (hit) {
      const call: LlmCall = { ...base, startedAt: hit.startedAt, latencyMs: hit.latencyMs, ...measure(hit.response), fromCache: true, error: null, response: hit.response };
      opts.ledger.add(call);
      return { response: hit.response, call };
    }

    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    try {
      const response = await send();
      const latencyMs = Math.round(performance.now() - t0);
      await opts.cache?.set(inputHash, { response, latencyMs, startedAt });
      const call: LlmCall = { ...base, startedAt, latencyMs, ...measure(response), fromCache: false, error: null, response };
      opts.ledger.add(call);
      return { response, call };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.ledger.add({ ...base, startedAt, latencyMs: Math.round(performance.now() - t0), usage: ZERO, costUsd: 0, fromCache: false, error: message, response: null });
      throw err;
    }
  }

  const openAIMeasure = (model: string) => (response: unknown) => {
    const usage = openAIUsage(response);
    return { usage, costUsd: costUsd("openai", model, usage) };
  };

  async function postPerplexity(body: unknown): Promise<unknown> {
    const { PERPLEXITY_API_KEY } = loadEnv(["PERPLEXITY_API_KEY"]);
    for (let attempt = 1; ; attempt++) {
      const res = await perplexityQueue.schedule(() =>
        fetchImpl(PERPLEXITY_ENDPOINT, {
          method: "POST",
          headers: { authorization: `Bearer ${PERPLEXITY_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(LLM_LIMITS.timeoutMs),
        }),
      );
      if (res === BUDGET_EXCEEDED) throw new Error("cola de Perplexity agotada");
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 3) throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, retryBaseMs * (2 ** attempt + Math.random() / 2)));
    }
  }

  return {
    async structured(req) {
      const body = {
        model: req.model,
        input: [
          { role: "system" as const, content: req.system },
          { role: "user" as const, content: req.user },
        ],
        text: { format: zodTextFormat(req.schema, req.name) },
        ...(req.model === MODELS.cheap ? { reasoning: { effort: "low" as const } } : {}),
      };
      const { response, call } = await openaiSlots(() =>
        run(req.purpose, "openai", req.model, body, async () => toJson(await openai().responses.create(body)), openAIMeasure(req.model)),
      );
      const r = response as { status?: string; incomplete_details?: { reason?: string } };
      if (r.status && r.status !== "completed") throw new Error(`Respuesta ${r.status}: ${r.incomplete_details?.reason ?? "sin detalle"}`);
      return { data: req.schema.parse(JSON.parse(openAIText(response))), call };
    },

    async search(req) {
      if (req.provider === "openai") {
        const body = openAISearchBody(req.model, req.query);
        const { response, call } = await openaiSlots(() =>
          run("visibility", "openai", req.model, body, async () => toJson(await openai().responses.create(body)), openAIMeasure(req.model)),
        );
        return { answer: parseOpenAISearch(response, req.model), call };
      }
      const body = perplexityBody(req.model, req.query);
      const { response, call } = await run("visibility", "perplexity", req.model, body, () => postPerplexity(body), (response) => {
        const { usage, reportedCostUsd } = perplexityUsage(response);
        return { usage, costUsd: reportedCostUsd ?? costUsd("perplexity", req.model, usage) };
      });
      const answer: SearchAnswer = parsePerplexity(response, req.model);
      return { answer, call };
    },
  };
}

/** Copia serializable de la respuesta del SDK (lo que se cachea y se guarda en llm_calls). */
function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

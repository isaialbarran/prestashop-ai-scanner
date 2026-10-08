import { domainOf } from "./openai";
import type { Citation, SearchAnswer, Usage } from "./types";

export const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/v1/agent";

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

/**
 * Petición a la Agent API. El preset `fast` aporta el prompt de sistema que obliga a citar con [n]
 * (sin él, `perplexity/sonar` responde sin citas en línea); `model` lo sustituye por el modelo propio
 * de Perplexity. `tools` sustituye el del preset para fijar la ubicación en España.
 */
export function perplexityBody(model: string, query: string) {
  return {
    preset: "fast",
    model,
    input: query,
    tools: [{ type: "web_search", user_location: { country: "ES" } }],
  };
}

export function perplexityUsage(response: unknown): { usage: Usage; reportedCostUsd: number | null } {
  const u = ((response as Json).usage ?? {}) as Json;
  const inDetails = (u.input_tokens_details ?? {}) as Json;
  const tools = ((u.tool_calls_details ?? {}) as Json).search_web as Json | undefined;
  const cost = (u.cost ?? null) as Json | null;
  return {
    usage: {
      inputTokens: Number(u.input_tokens ?? 0),
      cachedInputTokens: Number(inDetails.cache_read ?? inDetails.cached_tokens ?? 0),
      outputTokens: Number(u.output_tokens ?? 0),
      reasoningTokens: 0,
      searchCalls: Number(tools?.invocation ?? 0),
    },
    reportedCostUsd: cost && typeof cost.total_cost === "number" ? cost.total_cost : null,
  };
}

/**
 * La Agent API no devuelve un array de citas: el texto marca las fuentes con [n], que apuntan a `results[].id`.
 * Si no hay marcas no se puede saber qué fuentes usa la respuesta: no hay citas y solo cuenta la mención por nombre.
 */
export function parsePerplexity(response: unknown, model: string): SearchAnswer {
  const output = arr((response as Json).output);
  const text = output
    .filter((o) => o.type === "message")
    .flatMap((m) => arr(m.content))
    .filter((c) => c.type === "output_text")
    .map((c) => String(c.text ?? ""))
    .join("\n");

  const searchItems = output.filter((o) => o.type === "search_results");
  const results = new Map<number, Citation>();
  for (const r of searchItems.flatMap((s) => arr(s.results))) {
    if (typeof r.url !== "string") continue;
    results.set(Number(r.id), { url: r.url, title: typeof r.title === "string" ? r.title : null, domain: domainOf(r.url) });
  }

  const markers = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const marked = [...markers].map((id) => results.get(id)).filter((c): c is Citation => !!c);

  return {
    provider: "perplexity",
    model,
    text,
    cited: dedupe(marked),
    consulted: dedupe([...results.values()]),
    searchQueries: searchItems.flatMap((s) => (Array.isArray(s.queries) ? s.queries.map(String) : [])),
    citationMode: marked.length ? "markers" : "no-markers",
  };
}

function dedupe(list: Citation[]): Citation[] {
  return [...new Map(list.map((c) => [c.url, c])).values()];
}

import type { Citation, SearchAnswer, Usage } from "./types";

/** Dominio sin www, para comparar citas con la tienda. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase().replace(/^www\./, "");
  }
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

/** Petición al Responses API con búsqueda web forzada y ubicación en España. */
export function openAISearchBody(model: string, query: string) {
  return {
    model,
    input: query,
    tools: [{ type: "web_search" as const, user_location: { type: "approximate" as const, country: "ES" }, search_context_size: "low" as const }],
    // Se fuerza la búsqueda para medir visibilidad en buscador; con "auto" el modelo puede responder de memoria.
    tool_choice: "required" as const,
    include: ["web_search_call.action.sources" as const],
  };
}

export function openAIUsage(response: unknown): Usage {
  const r = response as Json;
  const u = (r.usage ?? {}) as Json;
  const inDetails = (u.input_tokens_details ?? {}) as Json;
  const outDetails = (u.output_tokens_details ?? {}) as Json;
  const searchCalls = arr(r.output).filter((o) => o.type === "web_search_call" && (o.action as Json | undefined)?.type === "search").length;
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    cachedInputTokens: Number(inDetails.cached_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    reasoningTokens: Number(outDetails.reasoning_tokens ?? 0),
    searchCalls,
  };
}

/** Texto de los mensajes del asistente (output_text). */
export function openAIText(response: unknown): string {
  return arr((response as Json).output)
    .filter((o) => o.type === "message")
    .flatMap((m) => arr(m.content))
    .filter((c) => c.type === "output_text")
    .map((c) => String(c.text ?? ""))
    .join("\n");
}

export function parseOpenAISearch(response: unknown, model: string): SearchAnswer {
  const output = arr((response as Json).output);
  const cited = new Map<string, Citation>();
  for (const content of output.filter((o) => o.type === "message").flatMap((m) => arr(m.content))) {
    for (const a of arr(content.annotations)) {
      if (a.type !== "url_citation" || typeof a.url !== "string") continue;
      cited.set(a.url, { url: a.url, title: typeof a.title === "string" ? a.title : null, domain: domainOf(a.url) });
    }
  }
  const searches = output.filter((o) => o.type === "web_search_call").map((o) => (o.action ?? {}) as Json);
  const consulted = new Map<string, Citation>();
  for (const s of searches.flatMap((a) => arr(a.sources))) {
    if (typeof s.url === "string") consulted.set(s.url, { url: s.url, title: null, domain: domainOf(s.url) });
  }
  for (const c of cited.values()) if (!consulted.has(c.url)) consulted.set(c.url, c);
  return {
    provider: "openai",
    model,
    text: openAIText(response),
    cited: [...cited.values()],
    consulted: [...consulted.values()],
    searchQueries: searches.flatMap((a) => [...(Array.isArray(a.queries) ? a.queries : []), ...(typeof a.query === "string" ? [a.query] : [])]).map(String),
    citationMode: "annotations",
  };
}

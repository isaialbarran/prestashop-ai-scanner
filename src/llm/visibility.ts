import { z } from "zod";
import { MODELS, PROVIDERS, type Provider } from "../../config/models";
import type { ScanSnapshot } from "../checks/types";
import type { AnswerOutcome, VisibilityResult } from "../schema";
import { BudgetExceededError } from "./cost";
import { domainOf } from "./openai";
import { storeNames, type BuyerQuery } from "./queries";
import type { Citation, Llm, LlmCall } from "./types";

export interface StoreIdentity {
  domains: string[];
  names: string[];
}

export function storeIdentity(snapshot: ScanSnapshot): StoreIdentity {
  const domains = new Set([domainOf(`https://${snapshot.domain}`)]);
  if (snapshot.origin) domains.add(domainOf(snapshot.origin));
  return { domains: [...domains], names: storeNames(snapshot) };
}

/** Paso 1, determinista: citas cuyo dominio es el de la tienda (o un subdominio suyo). */
export function storeCitations(cited: Citation[], domains: string[]): Citation[] {
  return cited.filter((c) => domains.some((d) => c.domain === d || c.domain.endsWith(`.${d}`)));
}

const MentionSchema = z.object({ mentioned: z.boolean(), quote: z.string().nullable() });
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Paso 2: un LLM barato decide si el texto nombra la tienda. Solo se acepta si devuelve un fragmento
 * que aparece literalmente en la respuesta; así no puede inventarse una mención.
 */
export async function detectMention(
  text: string,
  store: StoreIdentity,
  llm: Llm,
): Promise<{ mentioned: boolean; quote: string | null; call: LlmCall | null }> {
  if (!text.trim()) return { mentioned: false, quote: null, call: null };
  const { data, call } = await llm.structured({
    purpose: "detection",
    model: MODELS.cheap,
    name: "store_mention",
    schema: MentionSchema,
    system: "Decides si la respuesta de un asistente de IA menciona una tienda online concreta.",
    user: [
      `Tienda: ${store.names.join(", ")} (dominio ${store.domains.join(", ")}).`,
      "¿La respuesta menciona esta tienda por su nombre o su dominio como sitio donde comprar o informarse? Mencionar solo productos de una marca no cuenta, salvo que la marca sea la propia tienda.",
      "Si la menciona, copia literalmente en `quote` el fragmento donde aparece. Si no, mentioned=false y quote=null.",
      "",
      "Respuesta del asistente:",
      text,
    ].join("\n"),
  });
  const quoted = data.mentioned && !!data.quote && norm(text).includes(norm(data.quote));
  return { mentioned: quoted, quote: quoted ? data.quote : null, call };
}

export interface VisibilityOptions {
  providers?: readonly Provider[];
  models?: Partial<Record<Provider, string>>;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: MODELS.visibilityOpenAI,
  perplexity: MODELS.visibilityPerplexity,
};

export async function runVisibility(
  queries: BuyerQuery[],
  store: StoreIdentity,
  llm: Llm,
  opts: VisibilityOptions = {},
): Promise<VisibilityResult> {
  const providers = opts.providers ?? PROVIDERS;
  const tasks = queries.flatMap((q) => providers.map((provider) => ({ q, provider, model: opts.models?.[provider] ?? DEFAULT_MODELS[provider] })));

  const answers: AnswerOutcome[] = await Promise.all(
    tasks.map(async ({ q, provider, model }): Promise<AnswerOutcome> => {
      const base = { queryId: q.id, provider, model };
      try {
        const { answer, call } = await llm.search({ provider, model, query: q.text });
        const hits = storeCitations(answer.cited, store.domains);
        let method: AnswerOutcome["method"] = hits.length ? "domain" : null;
        let quote: string | null = null;
        if (!method) {
          const mention = await detectMention(answer.text, store, llm);
          if (mention.mentioned) {
            method = "name";
            quote = mention.quote;
          }
        }
        return {
          ...base,
          callId: call.id,
          cited: method !== null,
          method,
          storeUrls: hits.map((h) => h.url),
          quote,
          citedDomains: [...new Set(answer.cited.map((c) => c.domain))],
          citationMode: answer.citationMode,
          error: null,
          text: answer.text,
          citations: answer.cited.map((c) => ({ url: c.url, domain: c.domain })),
        };
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        return {
          ...base,
          callId: "",
          cited: false,
          method: null,
          storeUrls: [],
          quote: null,
          citedDomains: [],
          citationMode: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const ok = answers.filter((a) => !a.error);
  const byProvider: VisibilityResult["byProvider"] = {};
  for (const p of providers) {
    const mine = ok.filter((a) => a.provider === p);
    byProvider[p] = { cited: mine.filter((a) => a.cited).length, total: mine.length };
  }

  const counts = new Map<string, number>();
  for (const a of ok) {
    for (const d of a.citedDomains) {
      if (store.domains.some((s) => d === s || d.endsWith(`.${s}`))) continue;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const topCompetitors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([domain, n]) => ({ domain, answers: n }));

  return {
    providers: [...providers],
    queries,
    total: ok.length,
    citedIn: ok.filter((a) => a.cited).length,
    byProvider,
    topCompetitors,
    answers,
  };
}

import { z } from "zod";
import { MODELS } from "../../config/models";
import { analyzePage, type PageAnalysis } from "../checks/context";
import { isOrganizationType } from "../parse/structured";
import { collapse } from "../parse/html";
import type { ScanSnapshot } from "../checks/types";
import type { Llm, LlmCall } from "./types";

export const QUERY_KINDS = { category: 4, product: 4, purchase: 2 } as const;
export type QueryKind = keyof typeof QUERY_KINDS;

export interface BuyerQuery {
  /** q1…q10: lo que el informe usa como referencia. */
  id: string;
  kind: QueryKind;
  text: string;
  /** Se quitó el nombre de la tienda tras generarla. */
  sanitized: boolean;
}

export interface QueryContext {
  storeNames: string[];
  category: string | null;
  products: { name: string; attributes: string[]; description: string | null }[];
}

const compact = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const GENERIC = new Set(["inicio", "home", "tienda", "tiendaonline", "shop", "store", "online", "bienvenido"]);

/** Nombres con los que se identifica la tienda: dominio, og:site_name, Organization y el nombre corto del <title>. */
export function storeNames(snapshot: ScanSnapshot): string[] {
  const names = new Set<string>();
  const host = new URL(snapshot.origin ?? `https://${snapshot.domain}`).hostname.replace(/^www\./, "");
  names.add(host);
  names.add(host.split(".")[0]!);

  const home = analyzePage(snapshot.home);
  if (home) {
    const og = home.$('meta[property="og:site_name"]').attr("content");
    if (og) names.add(collapse(og));
    for (const n of home.sd.nodes.filter((n) => isOrganizationType(n.types))) {
      if (typeof n.data.name === "string") names.add(collapse(n.data.name));
    }
    const title = collapse(home.$("title").first().text());
    for (const part of title.split(/\s[|\-–·:]\s/).map((p) => p.trim())) {
      if (part && part.split(/\s+/).length <= 3) names.add(part);
    }
  }
  return [...names].filter((n) => compact(n).length >= 3 && !GENERIC.has(compact(n)));
}

/** Quita de la consulta las palabras que forman el nombre o el dominio de la tienda. */
export function sanitizeQuery(text: string, names: string[]): { text: string; changed: boolean } {
  const targets = names.map(compact).filter((n) => n.length >= 3);
  const words = text.split(/\s+/);
  const keep = words.map(() => true);
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= 3 && i + len <= words.length; len++) {
      const chunk = compact(words.slice(i, i + len).join(" "));
      // Una palabra suelta cuenta si empieza por el nombre ("FITmask's", "lylotools.es"), no si solo lo contiene ("decoración" ⊃ "ecor").
      if (chunk && targets.some((t) => chunk === t || (len === 1 && chunk.startsWith(t)))) {
        for (let k = i; k < i + len; k++) keep[k] = false;
      }
    }
  }
  const out = words
    .filter((_, i) => keep[i])
    .join(" ")
    .replace(/\s+([,.?])/g, "$1")
    .replace(/\b(de|en|la|el)\s*$/i, "")
    .trim();
  return { text: out, changed: out !== text.trim() };
}

export function mentionsStore(text: string, names: string[]): boolean {
  return sanitizeQuery(text, names).changed;
}

/** Contexto de la categoría y las 3 fichas para generar consultas. */
export function buildQueryContext(snapshot: ScanSnapshot): QueryContext {
  const pages = snapshot.products.map((p) => analyzePage(p.fetches.browser?.[0] ?? null)).filter((p): p is PageAnalysis => !!p);
  const category = analyzePage(snapshot.category);
  return {
    storeNames: storeNames(snapshot),
    category: category ? collapse(category.$("h1").first().text()) || null : null,
    products: pages.map((p) => ({
      name: p.signals.name ?? collapse(p.$("title").text()),
      attributes: p.$("dl.data-sheet dt, .product-features dt, #idTab2 td:first-child")
        .toArray()
        .map((dt) => `${collapse(p.$(dt).text())}: ${collapse(p.$(dt).next().text())}`)
        .filter((a) => a.length < 80)
        .slice(0, 6),
      description: p.signals.description?.text.slice(0, 400) ?? null,
    })),
  };
}

const QueriesSchema = z.object({
  category: z.array(z.string()),
  product: z.array(z.string()),
  purchase: z.array(z.string()),
});

export async function generateQueries(ctx: QueryContext, llm: Llm): Promise<{ queries: BuyerQuery[]; call: LlmCall }> {
  const forbidden = ctx.storeNames.map((n) => `"${n}"`).join(", ");
  const { data, call } = await llm.structured({
    purpose: "queries",
    model: MODELS.cheap,
    name: "buyer_queries",
    schema: QueriesSchema,
    system:
      "Eres un comprador en España que pregunta a un asistente de IA con búsqueda web. Escribes en español de España, con frases naturales y cortas, como las teclearía una persona.",
    user: [
      `Categoría: ${ctx.category ?? "(desconocida)"}`,
      ...ctx.products.map(
        (p, i) => `Producto ${i + 1}: ${p.name}\n  Atributos: ${p.attributes.join("; ") || "—"}\n  Descripción: ${p.description ?? "—"}`,
      ),
      "",
      "Escribe exactamente:",
      `- ${QUERY_KINDS.category} consultas de categoría, del tipo "mejor X para Y".`,
      `- ${QUERY_KINDS.product} consultas de producto que describan el tipo de producto con 1 o 2 atributos concretos (material, medida, uso). Puedes usar la marca del fabricante, no el nombre de un modelo exclusivo de esta tienda.`,
      `- ${QUERY_KINDS.purchase} consultas con intención de compra, del tipo "dónde comprar X en España".`,
      `Nunca menciones la tienda ni su dominio: ${forbidden}.`,
    ].join("\n"),
  });

  const queries: BuyerQuery[] = [];
  for (const kind of Object.keys(QUERY_KINDS) as QueryKind[]) {
    const list = data[kind].map((t) => collapse(t)).filter(Boolean);
    if (list.length < QUERY_KINDS[kind]) throw new Error(`El modelo devolvió ${list.length} consultas de tipo ${kind}`);
    for (const raw of list.slice(0, QUERY_KINDS[kind])) {
      const { text, changed } = sanitizeQuery(raw, ctx.storeNames);
      queries.push({ id: `q${queries.length + 1}`, kind, text, sanitized: changed });
    }
  }
  return { queries, call };
}

import type { Element } from "domhandler";
import { collapse, snippet, type Doc } from "./html";

export type SdSource = "jsonld" | "microdata";

/** Entidad tipada de schema.org encontrada en la página. */
export interface SdNode {
  source: SdSource;
  types: string[];
  data: Record<string, unknown>;
  /** true si cuelga de otro Product (variantes, relacionados). */
  insideProduct: boolean;
}

export interface JsonLdError {
  index: number;
  message: string;
  snippet: string;
}

export interface StructuredData {
  jsonLdBlocks: number;
  jsonLdErrors: JsonLdError[];
  nodes: SdNode[];
}

const PRODUCT_TYPES = new Set(["Product", "ProductGroup", "IndividualProduct", "ProductModel"]);
const ORGANIZATION_TYPES = new Set(["Organization", "OnlineStore", "OnlineBusiness", "Store", "LocalBusiness", "Corporation"]);

/** "https://schema.org/Product" o "schema:Product" → "Product". */
export function typeNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(/\s+/))
    .map((t) => t.split(/[/#:]/).pop() ?? "")
    .filter(Boolean);
}

export const isProductType = (types: string[]) => types.some((t) => PRODUCT_TYPES.has(t));
export const isOrganizationType = (types: string[]) => types.some((t) => ORGANIZATION_TYPES.has(t));

export function extractStructuredData($: Doc): StructuredData {
  const nodes: SdNode[] = [];
  const jsonLdErrors: JsonLdError[] = [];
  const scripts = $('script[type="application/ld+json"]').toArray();

  scripts.forEach((el, index) => {
    const raw = $(el).text().replace(/^\s*<!--|-->\s*$/g, "").replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, "");
    try {
      walkJsonLd(JSON.parse(raw), false, nodes);
    } catch (err) {
      jsonLdErrors.push({ index, message: err instanceof Error ? err.message : String(err), snippet: snippet(raw, 200) });
    }
  });

  $("[itemscope][itemtype]").each((_, el) => {
    const types = typeNames($(el).attr("itemtype"));
    if (types.length === 0) return;
    const insideProduct = $(el)
      .parents("[itemscope][itemtype]")
      .toArray()
      .some((p) => isProductType(typeNames($(p).attr("itemtype"))));
    nodes.push({ source: "microdata", types, data: microdataItem($, el), insideProduct });
  });

  return { jsonLdBlocks: scripts.length, jsonLdErrors, nodes };
}

export function hasType(sd: StructuredData, predicate: (types: string[]) => boolean): boolean {
  return sd.nodes.some((n) => predicate(n.types));
}

function walkJsonLd(value: unknown, insideProduct: boolean, out: SdNode[]): void {
  if (Array.isArray(value)) {
    for (const v of value) walkJsonLd(v, insideProduct, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const types = typeNames(obj["@type"]);
  if (types.length > 0) out.push({ source: "jsonld", types, data: obj, insideProduct });
  const childInside = insideProduct || isProductType(types);
  for (const [key, child] of Object.entries(obj)) {
    if (key !== "@context") walkJsonLd(child, childInside, out);
  }
}

function microdataItem($: Doc, el: Element): Record<string, unknown> {
  const data: Record<string, unknown> = { "@type": $(el).attr("itemtype") };
  $(el)
    .find("[itemprop]")
    .each((_, prop) => {
      if ($(prop).parent().closest("[itemscope]")[0] !== el) return;
      const value = $(prop).is("[itemscope]") ? microdataItem($, prop) : propValue($, prop);
      for (const name of ($(prop).attr("itemprop") ?? "").split(/\s+/).filter(Boolean)) {
        const prev = data[name];
        data[name] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
      }
    });
  return data;
}

function propValue($: Doc, el: Element): string {
  const $el = $(el);
  const tag = el.tagName.toLowerCase();
  if (tag === "meta") return $el.attr("content") ?? "";
  if (["link", "a", "area"].includes(tag)) return $el.attr("href") ?? "";
  if (["img", "audio", "video", "source", "embed", "iframe"].includes(tag)) return $el.attr("src") ?? "";
  if (tag === "object") return $el.attr("data") ?? "";
  if (tag === "time") return $el.attr("datetime") ?? collapse($el.text());
  if (tag === "data" || tag === "meter") return $el.attr("value") ?? "";
  return $el.attr("content") ?? collapse($el.text());
}

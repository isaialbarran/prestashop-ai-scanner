import { snippet } from "./html";
import { isProductType, type SdNode, type SdSource, type StructuredData } from "./structured";

/** Bloque Product normalizado, venga de JSON-LD o de microdatos. */
export interface ProductMarkup {
  source: SdSource;
  types: string[];
  name: string | null;
  sku: string | null;
  mpn: string | null;
  brand: string | null;
  gtin: string | null;
  gtinValid: boolean | null;
  price: number | null;
  currency: string | null;
  /** Último segmento de la URL de schema.org: InStock, OutOfStock… */
  availability: string | null;
  hasShipping: boolean;
  hasReturnPolicy: boolean;
  hasRating: boolean;
  snippet: string;
}

const GTIN_KEYS = ["gtin", "gtin13", "gtin12", "gtin14", "gtin8"];

/** Bloques Product de primer nivel (no variantes ni productos relacionados). */
export function productsOf(sd: StructuredData): ProductMarkup[] {
  return sd.nodes.filter((n) => !n.insideProduct && isProductType(n.types)).map(toProductMarkup);
}

export function toProductMarkup(node: SdNode): ProductMarkup {
  const d = node.data;
  let offers = objects(d.offers);
  if (offers.length === 0) offers = objects(d.hasVariant).flatMap((v) => objects(v.offers));
  const offer = offers[0] ?? {};
  const spec = objects(offer.priceSpecification)[0] ?? {};
  const gtin = firstText([d, ...offers], GTIN_KEYS);

  return {
    source: node.source,
    types: node.types,
    name: text(d.name),
    sku: text(d.sku) ?? text(offer.sku),
    mpn: text(d.mpn) ?? text(offer.mpn),
    brand: text(d.brand) ?? text(d.manufacturer),
    gtin,
    gtinValid: gtin === null ? null : isValidGtin(gtin),
    price: parsePrice(offer.price ?? offer.lowPrice ?? spec.price),
    currency: text(offer.priceCurrency) ?? text(spec.priceCurrency),
    availability: schemaEnum(offer.availability),
    hasShipping: offers.some((o) => o.shippingDetails != null),
    hasReturnPolicy: d.hasMerchantReturnPolicy != null || offers.some((o) => o.hasMerchantReturnPolicy != null),
    hasRating: objects(d.aggregateRating).some((r) => r.ratingValue != null),
    snippet: snippet(JSON.stringify(d), 300),
  };
}

/** "1.234,56", "1,234.56", "19,90", "19.90", 19.9 → número. */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;
  let s = raw.replace(/[^\d.,-]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function schemaEnum(value: unknown): string | null {
  const raw = text(value);
  return raw ? (raw.split(/[/#:]/).pop() ?? null) : null;
}

function objects(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
}

function text(value: unknown): string | null {
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return text(o.name ?? o["@value"] ?? null);
  }
  return null;
}

function firstText(sources: Record<string, unknown>[], keys: string[]): string | null {
  for (const s of sources) {
    for (const k of keys) {
      const v = text(s[k]);
      if (v) return v.replace(/\s+/g, "");
    }
  }
  return null;
}

import { load } from "cheerio";

export interface SitemapEntry {
  loc: string;
  hasImage: boolean;
}

export interface SitemapDoc {
  kind: "index" | "urlset" | "invalid";
  entries: SitemapEntry[];
}

export function parseSitemap(xml: string | null): SitemapDoc {
  if (!xml || !/<(sitemapindex|urlset)[\s>]/i.test(xml)) return { kind: "invalid", entries: [] };
  const $ = load(xml, { xml: true });
  if ($("sitemapindex").length) {
    return {
      kind: "index",
      entries: $("sitemap > loc")
        .toArray()
        .map((el) => ({ loc: $(el).text().trim(), hasImage: false })),
    };
  }
  return {
    kind: "urlset",
    entries: $("url")
      .toArray()
      .map((el) => ({
        loc: $(el).children("loc").first().text().trim(),
        hasImage: $(el).children("image\\:image").length > 0,
      }))
      .filter((e) => e.loc),
  };
}

/** Ordena los sitemaps hijos poniendo primero los del idioma pedido (gsitemap: 1_es_0_sitemap.xml). */
export function preferLanguage(locs: string[], lang = "es"): string[] {
  const re = new RegExp(`(^|[/_-])${lang}([/_.-]|$)`, "i");
  return [...locs.filter((l) => re.test(l)), ...locs.filter((l) => !re.test(l))];
}

export type UrlKind = "product" | "category" | "other";

/** Clasifica URLs con las rutas por defecto de PrestaShop. */
export function classifyUrl(url: string, hasImage = false): UrlKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  const q = u.searchParams;
  if (q.get("controller") === "product" || q.has("id_product")) return "product";
  if (q.get("controller") === "category" || q.has("id_category")) return "category";

  const segments = u.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  if (/^\d+(-\d+)?-[^/]+\.html$/.test(last)) return "product";
  if (hasImage && last.endsWith(".html")) return "product";

  const withoutLang = segments.length === 2 && /^[a-z]{2}$/.test(segments[0]!) ? segments.slice(1) : segments;
  if (withoutLang.length === 1 && /^\d+-[^/.]+$/.test(withoutLang[0]!)) return "category";
  return "other";
}

/** Barajado determinista: la misma semilla da siempre el mismo orden. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let state = h >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

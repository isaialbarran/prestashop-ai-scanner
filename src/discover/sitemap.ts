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

const ACTION_PARAMS = ["add", "delete", "token", "qty", "op", "action", "ajax", "back", "submitAddress"];
const ACTION_CONTROLLERS = /^(cart|order|order-confirmation|authentication|my-account|password|history|identity|addresses|address|guest-tracking|module-.*)$/i;
const ACTION_PATHS = /\/(carrito|carro-de-la-compra|cart|pedido|order|checkout|iniciar-sesion|inicio-sesion|login|mi-cuenta|my-account|direccion|recuperar-contrasena)(\/|$|\?)/i;

/** URLs que ejecutan una acción (añadir al carrito, login, pedido…): el escáner nunca las pide. */
export function isActionUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (ACTION_PARAMS.some((p) => u.searchParams.has(p))) return true;
  if (ACTION_CONTROLLERS.test(u.searchParams.get("controller") ?? "")) return true;
  return ACTION_PATHS.test(u.pathname);
}

/** Primeros segmentos que nunca son fichas ni categorías (CMS, módulos, blog). */
const NON_CATALOG = new Set(["content", "contenido", "cms", "module", "modules", "blog", "img", "themes"]);

/**
 * Clasifica URLs con las rutas de PrestaShop: por defecto `{categoría/}{id}-{slug}.html` para fichas y
 * `{id}-{slug}` para categorías, y también la variante de ficha sin `.html` bajo una categoría.
 * Las URLs sin id (módulos de URL amigables) quedan como `other`: se buscan por las miniaturas de la portada.
 */
export function classifyUrl(url: string, hasImage = false): UrlKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  if (isActionUrl(url)) return "other";
  const q = u.searchParams;
  if (q.get("controller") === "product" && q.has("id_product")) return "product";
  if (q.get("controller") === "category" && q.has("id_category")) return "category";

  const all = u.pathname.split("/").filter(Boolean);
  const segments = all.length > 1 && /^[a-z]{2}$/.test(all[0]!) ? all.slice(1) : all;
  if (segments.length === 0 || NON_CATALOG.has(segments[0]!.toLowerCase())) return "other";
  const last = segments.at(-1)!;

  if (/^\d+(-\d+)?-[^/]+\.html$/.test(last)) return "product";
  if (hasImage && last.endsWith(".html")) return "product";
  if (segments.length >= 2 && /^\d+(-\d+)?-[^/.]+$/.test(last)) return "product";
  if (segments.length === 1 && /^\d+-[^/.]+$/.test(last)) return "category";
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

import type { AgentId } from "../../config/agents";
import { interpretRobots, type RobotsInfo } from "../discover/robots";
import { parseSitemap } from "../discover/sitemap";
import type { FetchResult } from "../fetch/types";
import { bodyId, canonicalOf, hreflangOf, loadHtml, metaRobots, visibleText, type Doc } from "../parse/html";
import { productsOf, type ProductMarkup } from "../parse/product";
import { extractStructuredData, type StructuredData } from "../parse/structured";
import { visibleSignals, type VisibleSignals } from "../parse/visible";
import type { ScanSnapshot } from "./types";

/** Una página HTML (200) ya analizada; se calcula una vez y la comparten todos los checks. */
export interface PageAnalysis {
  res: FetchResult;
  url: string;
  $: Doc;
  bodyId: string | null;
  sd: StructuredData;
  products: ProductMarkup[];
  signals: VisibleSignals;
  canonical: string | null;
  hreflang: { lang: string; href: string | null }[];
  metaRobots: string | null;
  /** `prestashop.configuration.is_catalog` del tema. */
  isCatalog: boolean;
}

export interface ProductContext {
  url: string;
  fetches: Partial<Record<AgentId, FetchResult[]>>;
  /** Respuesta del navegador (primer intento). */
  browser: FetchResult | null;
  /** Análisis de la ficha tal como la ve el navegador; null si no devolvió 200. */
  page: PageAnalysis | null;
}

export interface ScanContext {
  snap: ScanSnapshot;
  robots: RobotsInfo | null;
  home: PageAnalysis | null;
  category: PageAnalysis | null;
  products: ProductContext[];
  /** Hay más de un idioma: sitemaps por idioma, hreflang en portada o selector de idioma. */
  multilingual: boolean;
}

export function analyzePage(res: FetchResult | null): PageAnalysis | null {
  if (!res || res.status !== 200 || !res.body) return null;
  const $ = loadHtml(res.body);
  const sd = extractStructuredData($);
  return {
    res,
    url: res.finalUrl,
    $,
    bodyId: bodyId($),
    sd,
    products: productsOf(sd),
    signals: visibleSignals($),
    canonical: canonicalOf($, res.finalUrl),
    hreflang: hreflangOf($, res.finalUrl),
    metaRobots: metaRobots($),
    isCatalog: /"is_catalog"\s*:\s*true/.test(res.body),
  };
}

export function buildContext(snap: ScanSnapshot): ScanContext {
  const robots = snap.robots && snap.robotsUrl ? interpretRobots(snap.robots, snap.robotsUrl) : null;
  const home = analyzePage(snap.home);
  const products = snap.products.map((p) => {
    const browser = p.fetches.browser?.[0] ?? null;
    return { url: p.url, fetches: p.fetches, browser, page: analyzePage(browser) };
  });
  return {
    snap,
    robots,
    home,
    category: analyzePage(snap.category),
    products,
    multilingual: isMultilingual(snap, home),
  };
}

const textLengths = new WeakMap<FetchResult, number>();

/** Longitud del texto visible de una respuesta (memoizada). */
export function textLength(res: FetchResult): number {
  let n = textLengths.get(res);
  if (n === undefined) {
    n = res.body ? visibleText(res.body).length : 0;
    textLengths.set(res, n);
  }
  return n;
}

function isMultilingual(snap: ScanSnapshot, home: PageAnalysis | null): boolean {
  if (home && home.hreflang.filter((h) => h.lang !== "x-default").length > 1) return true;
  if (home && home.$(".language-selector, #_desktop_language_selector, #languages-block-top").length > 0) return true;
  const langs = new Set<string>();
  for (const res of snap.sitemaps) {
    const doc = parseSitemap(res.status === 200 ? res.body : null);
    if (doc.kind !== "index") continue;
    for (const e of doc.entries) {
      const m = e.loc.match(/\d+_([a-z]{2})_\d+_sitemap\.xml$/i);
      if (m) langs.add(m[1]!.toLowerCase());
    }
  }
  return langs.size > 1;
}

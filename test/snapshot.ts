import { AGENT_IDS, type AgentId } from "../config/agents";
import type { ProductSnapshot, ScanSnapshot } from "../src/checks/types";
import type { FetchResult } from "../src/fetch/types";
import { fixture } from "./fixtures";

export const ORIGIN = "https://tienda.test";
export const CLASSIC_URL = `${ORIGIN}/zapatillas/12-zapatilla-trail-ligera-2.html`;
export const PRODUCT_URLS = [
  CLASSIC_URL,
  `${ORIGIN}/zapatillas/13-zapatilla-asfalto.html`,
  `${ORIGIN}/mochilas/32-1-mochila-trail-12l.html`,
];

export function fr(
  url: string,
  status: number | null,
  body: string | null = "",
  over: Partial<FetchResult> = {},
): FetchResult {
  return {
    url,
    finalUrl: url,
    agent: "browser",
    attempt: 1,
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
    bytes: body?.length ?? 0,
    truncated: false,
    redirects: [],
    ttfbMs: 300,
    totalMs: 450,
    error: status === null ? "fetch failed (ENOTFOUND)" : null,
    fromCache: false,
    ...over,
  };
}

/** HTML de la ficha classic con sus URLs reescritas para que apunten a `url`. */
export function classicAt(url: string): string {
  return fixture("html/product-classic.html").replaceAll(CLASSIC_URL, url);
}

/** Ficha que responde igual a todos los agentes, salvo los que se sobrescriban. */
export function product(
  url: string,
  html: string,
  over: Partial<Record<AgentId, FetchResult[]>> = {},
): ProductSnapshot {
  const fetches: Partial<Record<AgentId, FetchResult[]>> = {};
  for (const agent of AGENT_IDS) fetches[agent] = [fr(url, 200, html, { agent })];
  return { url, fetches: { ...fetches, ...over } };
}

export function snapshot(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    domain: "tienda.test",
    origin: ORIGIN,
    home: fr(`${ORIGIN}/`, 200, fixture("html/home.html")),
    robotsUrl: `${ORIGIN}/robots.txt`,
    robots: fr(`${ORIGIN}/robots.txt`, 200, fixture("robots/allow-all.txt"), { headers: { "content-type": "text/plain" } }),
    sitemaps: [
      fr(`${ORIGIN}/1_index_sitemap.xml`, 200, fixture("sitemap/index.xml")),
      fr(`${ORIGIN}/1_es_0_sitemap.xml`, 200, fixture("sitemap/es.xml")),
    ],
    category: fr(`${ORIGIN}/3-zapatillas`, 200, fixture("html/category.html")),
    facets: { orderUrl: null, qUrl: null, order: null, q: null },
    products: PRODUCT_URLS.map((url) => product(url, classicAt(url))),
    ucp: fr(`${ORIGIN}/.well-known/ucp`, 404, "<html>404</html>"),
    llms: fr(`${ORIGIN}/llms.txt`, 404, "<html>404</html>"),
    pagespeed: null,
    extracted: null,
    ...over,
  };
}

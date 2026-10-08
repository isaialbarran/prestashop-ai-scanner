import { randomUUID } from "node:crypto";
import { AGENTS, CAP_AGENTS, CRAWLERS } from "../config/agents";
import { SCANNER_VERSION, THRESHOLDS } from "../config/scanner";
import { crawlerVerdict } from "./checks/access";
import { analyzePage } from "./checks/context";
import { sameSite } from "./checks/helpers";
import { runAllChecks } from "./checks/index";
import { detectPlatform } from "./checks/info";
import type { ProductSnapshot, ScanSnapshot } from "./checks/types";
import { crawlDelayMs, interpretRobots, robotsVerdict, type RobotsInfo } from "./discover/robots";
import { classifyUrl, parseSitemap, preferLanguage, seededShuffle } from "./discover/sitemap";
import type { PageSpeedResult } from "./fetch/pagespeed";
import type { Fetcher } from "./fetch/types";
import { absoluteUrl } from "./parse/html";
import { ScanResultSchema, type ScanResult } from "./schema";
import { computeScore } from "./scoring/score";

export interface ScanOptions {
  /** Un fetcher por dominio: lleva la cola, el presupuesto y la caché de ese dominio. */
  fetcher: Fetcher;
  pagespeed?: (url: string) => Promise<PageSpeedResult>;
  log?: (message: string) => void;
}

export interface ScanOutput {
  result: ScanResult;
  snapshot: ScanSnapshot;
}

const MAX_SITEMAP_FETCHES = 3;
const MAX_PRODUCT_REJECTS = 2;

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]!
    .replace(/\.$/, "");
}

export async function scanDomain(input: string, opts: ScanOptions): Promise<ScanOutput> {
  const started = performance.now();
  const domain = normalizeDomain(input);
  const errors: string[] = [];
  const snapshot = await collect(domain, opts, errors);
  const checks = runAllChecks(snapshot);
  const platform = detectPlatform([snapshot.home, ...snapshot.products.map((p) => p.fetches.browser?.[0] ?? null)]);
  const stats = opts.fetcher.stats();

  const result = ScanResultSchema.parse({
    id: randomUUID(),
    domain,
    origin: snapshot.origin,
    scannedAt: new Date().toISOString(),
    scannerVersion: SCANNER_VERSION,
    platform: { prestashop: platform.prestashop, version: platform.version },
    pages: {
      home: snapshot.home?.finalUrl ?? null,
      category: snapshot.category?.finalUrl ?? null,
      products: snapshot.products.map((p) => p.url),
    },
    checks,
    score: computeScore(checks),
    requests: { network: stats.network, cached: stats.cached, budget: stats.budget },
    durationMs: Math.round(performance.now() - started),
    errors,
  } satisfies ScanResult);
  return { result, snapshot };
}

async function collect(domain: string, opts: ScanOptions, errors: string[]): Promise<ScanSnapshot> {
  const { fetcher } = opts;
  const log = (m: string) => opts.log?.(`${domain}: ${m}`);
  const snap: ScanSnapshot = {
    domain,
    origin: null,
    home: null,
    robotsUrl: null,
    robots: null,
    sitemaps: [],
    category: null,
    facets: { orderUrl: null, qUrl: null, order: null, q: null },
    products: [],
    ucp: null,
    llms: null,
    pagespeed: null,
    extracted: null,
  };

  // 1. Portada (https y, si no responde, http).
  let home = await fetcher.get(`https://${domain}/`, "browser");
  if (home.status === null && !home.error?.includes("presupuesto")) {
    const plain = await fetcher.get(`http://${domain}/`, "browser");
    if (plain.status !== null) home = plain;
  }
  snap.home = home;
  if (home.status === null) {
    errors.push(`La portada no responde: ${home.error}`);
    return snap;
  }
  const origin = new URL(home.finalUrl).origin;
  snap.origin = origin;

  // 2. robots.txt y Crawl-delay.
  snap.robotsUrl = `${origin}/robots.txt`;
  snap.robots = await fetcher.get(snap.robotsUrl, "browser");
  const robots = interpretRobots(snap.robots, snap.robotsUrl);
  const delay = crawlDelayMs(robots, CRAWLERS.map((a) => AGENTS[a].robotsToken!));
  if (delay && delay > 1000) {
    fetcher.setMinInterval(delay);
    log(`Crawl-delay ${delay / 1000} s`);
  }

  // 3. Sitemap → URLs candidatas; si no hay, enlaces de la portada.
  const { products: productUrls, categories } = await discoverUrls(snap, robots, origin, fetcher);
  log(`${productUrls.length} fichas y ${categories.length} categorías candidatas`);
  if (productUrls.length === 0) errors.push("No se encontraron fichas de producto en el sitemap ni en la portada");

  // 4. Tres fichas confirmadas con el navegador.
  snap.products = await pickProducts(productUrls, domain, fetcher);
  const psi = opts.pagespeed?.(snap.products[0]?.url ?? home.finalUrl);

  // 5. Primer intento de cada rastreador.
  for (const p of snap.products) {
    for (const agent of CRAWLERS) p.fetches[agent] = [await fetcher.get(p.url, agent)];
  }

  // 6. Categoría y URLs de filtros (D3).
  for (const url of seededShuffle(categories, domain).slice(0, 2)) {
    snap.category = await fetcher.get(url, "browser");
    if (snap.category.status === 200) break;
  }
  await fetchFacets(snap, robots, fetcher);

  // 7. Segundo intento solo donde el primero falló (A2).
  for (const p of snap.products) {
    const browser = p.fetches.browser?.[0] ?? null;
    for (const agent of CRAWLERS) {
      const attempts = p.fetches[agent]!;
      if (crawlerVerdict(browser, attempts[0]!).ok === false) attempts.push(await fetcher.get(p.url, agent, { attempt: 2 }));
    }
  }

  // 8. Informativos.
  snap.ucp = await fetcher.get(`${origin}/.well-known/ucp`, "browser");
  snap.llms = await fetcher.get(`${origin}/llms.txt`, "browser");

  if (psi) snap.pagespeed = await psi;
  return snap;
}

async function discoverUrls(
  snap: ScanSnapshot,
  robots: RobotsInfo,
  origin: string,
  fetcher: Fetcher,
): Promise<{ products: string[]; categories: string[] }> {
  const declared = robots.kind === "parsed" ? robots.sitemaps.filter((s) => sameSite(s, origin)) : [];
  const queue = declared.length ? [...declared] : [`${origin}/1_index_sitemap.xml`, `${origin}/sitemap.xml`];
  const products = new Set<string>();
  const categories = new Set<string>();

  while (queue.length && snap.sitemaps.length < MAX_SITEMAP_FETCHES) {
    const res = await fetcher.get(queue.shift()!, "browser");
    snap.sitemaps.push(res);
    const doc = parseSitemap(res.status === 200 ? res.body : null);
    if (doc.kind === "index") {
      queue.splice(0, queue.length, ...preferLanguage(doc.entries.map((e) => e.loc)));
      continue;
    }
    for (const e of doc.entries) {
      if (!sameSite(e.loc, origin)) continue;
      const kind = classifyUrl(e.loc, e.hasImage);
      if (kind === "product") products.add(e.loc);
      else if (kind === "category") categories.add(e.loc);
    }
    if (doc.kind === "urlset" && products.size >= THRESHOLDS.productsPerDomain * 2 && categories.size > 0) break;
  }

  if (products.size === 0 || categories.size === 0) {
    const home = analyzePage(snap.home);
    home?.$("a[href]").each((_, a) => {
      const url = absoluteUrl(home.$(a).attr("href"), home.url);
      if (!url || !sameSite(url, origin)) return;
      const clean = url.split("#")[0]!;
      const kind = classifyUrl(clean);
      if (kind === "product" && products.size < 50) products.add(clean);
      if (kind === "category" && categories.size < 50) categories.add(clean);
    });
  }
  return { products: [...products], categories: [...categories] };
}

async function pickProducts(candidates: string[], seed: string, fetcher: Fetcher): Promise<ProductSnapshot[]> {
  const chosen: ProductSnapshot[] = [];
  let rejects = 0;
  for (const url of seededShuffle(candidates, seed)) {
    if (chosen.length >= THRESHOLDS.productsPerDomain) break;
    const res = await fetcher.get(url, "browser");
    if (res.error?.includes("presupuesto")) break;
    const page = analyzePage(res);
    const looksLikeProduct = !!page && (page.bodyId === "product" || page.products.length > 0);
    if (!looksLikeProduct && rejects < MAX_PRODUCT_REJECTS) {
      rejects++;
      continue;
    }
    chosen.push({ url, fetches: { browser: [res] } });
  }
  return chosen;
}

/** Pide la categoría con ?order= y ?q= solo si robots.txt no las bloquea para los agentes del tope. */
async function fetchFacets(snap: ScanSnapshot, robots: RobotsInfo, fetcher: Fetcher): Promise<void> {
  const category = analyzePage(snap.category);
  if (!category) return;
  const base = category.url.split("?")[0]!;
  const link = (pattern: RegExp) => {
    const href = category.$("a[href]")
      .toArray()
      .map((a) => absoluteUrl(category.$(a).attr("href"), category.url))
      .find((u) => u && u.startsWith(base) && pattern.test(u));
    return href ?? null;
  };
  const blocked = (url: string) =>
    CAP_AGENTS.every((a) => robotsVerdict(robots, url, AGENTS[a].robotsToken!).allowed === false);

  snap.facets.orderUrl = link(/[?&]order=/) ?? `${base}?order=product.price.asc`;
  snap.facets.qUrl = link(/[?&]q=/);
  if (!blocked(snap.facets.orderUrl)) snap.facets.order = await fetcher.get(snap.facets.orderUrl, "browser");
  if (snap.facets.qUrl && !blocked(snap.facets.qUrl)) snap.facets.q = await fetcher.get(snap.facets.qUrl, "browser");
}

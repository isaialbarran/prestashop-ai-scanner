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
import { candidateCount, categoryFromProductPage, collectCandidates, type Candidates } from "./discover/candidates";
import { isActionUrl, parseSitemap, preferLanguage, seededShuffle, type SitemapDoc } from "./discover/sitemap";
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
const MAX_NOT_PRODUCT = 4;

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
  const { snapshot, errors } = await collectSnapshot(input, opts);
  return { result: evaluateSnapshot(snapshot, { fetcher: opts.fetcher, started, errors }), snapshot };
}

/** Paso 1: todas las peticiones a la tienda. Lo que se descarga queda en el snapshot. */
export async function collectSnapshot(input: string, opts: ScanOptions): Promise<{ snapshot: ScanSnapshot; errors: string[] }> {
  const errors: string[] = [];
  const snapshot = await collect(normalizeDomain(input), opts, errors);
  return { snapshot, errors };
}

/**
 * Paso 2: checks y nota sobre el snapshot, sin red. La capa LLM rellena `snapshot.extracted`
 * antes de llamar aquí para que C2 deje de ser inconcluso.
 */
export function evaluateSnapshot(
  snapshot: ScanSnapshot,
  ctx: { fetcher: Fetcher; started: number; errors: string[] },
): ScanResult {
  const errors = [...ctx.errors];
  const checks = runAllChecks(snapshot);
  const score = computeScore(checks);
  if (score.final === null && score.evaluated > 0) {
    errors.push(`Cobertura insuficiente (${Math.round(score.coverage * 100)} % de los puntos): sin nota`);
  }
  const platform = detectPlatform([snapshot.home, ...snapshot.products.map((p) => p.fetches.browser?.[0] ?? null)]);
  const stats = ctx.fetcher.stats();

  return ScanResultSchema.parse({
    id: randomUUID(),
    domain: snapshot.domain,
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
    score,
    requests: { network: stats.network, cached: stats.cached, budget: stats.budget },
    durationMs: Math.round(performance.now() - ctx.started),
    errors,
  } satisfies ScanResult);
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

  // 3. Sitemap y portada → fichas candidatas por niveles de fiabilidad.
  const candidates = await discoverUrls(snap, robots, origin, fetcher);
  log(`${candidateCount(candidates)} fichas y ${candidates.categories.length} categorías candidatas`);
  if (candidateCount(candidates) === 0) errors.push("No se encontraron fichas de producto en el sitemap ni en la portada");

  // 4. Tres fichas confirmadas con el navegador.
  snap.products = await pickProducts(candidates.productTiers, domain, fetcher);
  const psi = opts.pagespeed?.(snap.products[0]?.url ?? home.finalUrl);

  // 5. Primer intento de cada rastreador.
  for (const p of snap.products) {
    for (const agent of CRAWLERS) p.fetches[agent] = [await fetcher.get(p.url, agent)];
  }

  // 6. Categoría (del sitemap o, si no hay, de las migas de una ficha) y URLs de filtros (D3).
  let categories = candidates.categories;
  if (categories.length === 0) {
    const fromBreadcrumb = snap.products
      .map((p) => analyzePage(p.fetches.browser?.[0] ?? null))
      .map((page) => (page ? categoryFromProductPage(page, origin) : null))
      .find((u): u is string => u !== null);
    if (fromBreadcrumb) categories = [fromBreadcrumb];
  }
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

async function discoverUrls(snap: ScanSnapshot, robots: RobotsInfo, origin: string, fetcher: Fetcher): Promise<Candidates> {
  const declared = robots.kind === "parsed" ? robots.sitemaps.filter((s) => sameSite(s, origin)) : [];
  const queue = declared.length ? [...declared] : [`${origin}/1_index_sitemap.xml`, `${origin}/sitemap.xml`];
  const docs: SitemapDoc[] = [];
  const home = analyzePage(snap.home);

  while (queue.length && snap.sitemaps.length < MAX_SITEMAP_FETCHES) {
    const res = await fetcher.get(queue.shift()!, "browser");
    snap.sitemaps.push(res);
    const doc = parseSitemap(res.status === 200 ? res.body : null);
    if (doc.kind === "index") {
      queue.splice(0, queue.length, ...preferLanguage(doc.entries.map((e) => e.loc)));
      continue;
    }
    docs.push(doc);
    const found = collectCandidates(docs, null, origin);
    if ((found.productTiers[0]?.length ?? 0) >= THRESHOLDS.productsPerDomain * 2 && found.categories.length > 0) break;
  }
  return collectCandidates(docs, home, origin);
}

async function pickProducts(tiers: string[][], seed: string, fetcher: Fetcher): Promise<ProductSnapshot[]> {
  const chosen: ProductSnapshot[] = [];
  let unreadable = 0;
  let notProduct = 0;
  for (const url of tiers.flatMap((tier) => seededShuffle(tier, seed)).filter((u) => !isActionUrl(u))) {
    if (chosen.length >= THRESHOLDS.productsPerDomain) break;
    const res = await fetcher.get(url, "browser");
    if (res.error?.includes("presupuesto") || res.error?.includes("dejan de enviar")) break;
    const page = analyzePage(res);
    // Si el tema pone body id, manda: los listados también llevan marcado Product (p. ej. una ficha
    // descatalogada que redirige a su categoría). Esas páginas nunca se aceptan.
    if (page?.bodyId && page.bodyId !== "product") {
      if (++notProduct > MAX_NOT_PRODUCT) break;
      continue;
    }
    // Una página que no se puede leer (reto, error) se acepta tras dos intentos, para que A2 lo refleje.
    if (!page || (!page.bodyId && page.products.length === 0)) {
      if (unreadable++ < MAX_PRODUCT_REJECTS) continue;
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

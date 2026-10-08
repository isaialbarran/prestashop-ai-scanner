import { describe, expect, it } from "vitest";
import { AGENTS } from "../config/agents";
import { fixture } from "../test/fixtures";
import { classicAt } from "../test/snapshot";
import { createFetcher } from "./fetch/client";
import { DomainLimiter } from "./fetch/limiter";
import type { FetchImpl } from "./fetch/types";
import { normalizeDomain, scanDomain } from "./scan";
import { ScanResultSchema } from "./schema";

const O = "https://tienda.test";

/** Tienda falsa servida desde fixtures; `blockAgent` responde 403 a ese user-agent en las fichas. */
function fakeShop(opts: { blockAgent?: string } = {}) {
  const pages: Record<string, () => string> = {
    [`${O}/`]: () => fixture("html/home.html"),
    [`${O}/robots.txt`]: () => fixture("robots/allow-all.txt"),
    [`${O}/1_index_sitemap.xml`]: () => fixture("sitemap/index.xml"),
    [`${O}/1_es_0_sitemap.xml`]: () => fixture("sitemap/es.xml"),
    [`${O}/3-zapatillas`]: () => fixture("html/category.html"),
    [`${O}/4-mochilas`]: () => fixture("html/category.html"),
    [`${O}/zapatillas/12-zapatilla-trail-ligera-2.html`]: () => fixture("html/product-classic.html"),
    [`${O}/zapatillas/13-zapatilla-asfalto.html`]: () => classicAt(`${O}/zapatillas/13-zapatilla-asfalto.html`),
    [`${O}/mochilas/31-mochila-urbana-20l.html`]: () => fixture("html/product-conflict.html"),
    [`${O}/mochilas/32-1-mochila-trail-12l.html`]: () => classicAt(`${O}/mochilas/32-1-mochila-trail-12l.html`),
    [`${O}/index.php?id_product=40&controller=product&id_lang=1`]: () => fixture("html/product-16.html"),
  };
  const calls: { url: string; ua: string; method: string }[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const ua = new Headers(init.headers).get("user-agent") ?? "";
    calls.push({ url, ua, method: init.method ?? "GET" });
    if (url === "http://tienda.test/") return new Response(null, { status: 301, headers: { location: `${O}/` } });
    const page = pages[url];
    if (!page) return new Response("<html><body>404</body></html>", { status: 404 });
    if (opts.blockAgent && ua.includes(opts.blockAgent) && /\.html|id_product/.test(url)) {
      return new Response("<h1>Forbidden</h1>", { status: 403, headers: { server: "nginx" } });
    }
    return new Response(page(), { status: 200, headers: { "content-type": url.endsWith(".xml") ? "application/xml" : "text/html" } });
  };
  return { fetchImpl, calls };
}

const fetcherFor = (fetchImpl: FetchImpl) =>
  createFetcher({ fetchImpl, limiter: new DomainLimiter({ minIntervalMs: 0, budget: 40 }) });

describe("scanDomain", () => {
  it("devuelve un ScanResult válido, con tres fichas y dentro del presupuesto", async () => {
    const shop = fakeShop();
    const { result } = await scanDomain("https://Tienda.test/es/", { fetcher: fetcherFor(shop.fetchImpl) });

    expect(ScanResultSchema.safeParse(result).success).toBe(true);
    expect(result.domain).toBe("tienda.test");
    expect(result.pages.products).toHaveLength(3);
    expect(result.platform).toEqual({ prestashop: true, version: "1.7 o posterior" });
    expect(result.requests.network).toBeLessThanOrEqual(40);
    expect(shop.calls.every((c) => c.method === "GET")).toBe(true);
    expect(result.checks.find((c) => c.id === "C2")?.status).toBe("inconclusive");
    expect(result.score.coverage).toBeLessThan(1);
  });

  it("elige las mismas fichas en cada ejecución", async () => {
    const a = await scanDomain("tienda.test", { fetcher: fetcherFor(fakeShop().fetchImpl) });
    const b = await scanDomain("tienda.test", { fetcher: fetcherFor(fakeShop().fetchImpl) });
    expect(a.result.pages.products).toEqual(b.result.pages.products);
  });

  it("reintenta al rastreador bloqueado, marca el fallo de origen y aplica el tope", async () => {
    const shop = fakeShop({ blockAgent: "OAI-SearchBot" });
    const { result, snapshot } = await scanDomain("tienda.test", { fetcher: fetcherFor(shop.fetchImpl) });

    const a2 = result.checks.find((c) => c.id === "A2")!;
    expect(a2.perAgent?.["oai-searchbot"]).toBe("fail");
    expect(a2.blockKind?.["oai-searchbot"]).toBe("origen");
    expect(snapshot.products.every((p) => p.fetches["oai-searchbot"]?.length === 2)).toBe(true);
    expect(snapshot.products.every((p) => p.fetches.googlebot?.length === 1)).toBe(true);
    expect(result.score.cap).toBe(40);
    expect(result.score.final).toBeLessThanOrEqual(40);
  });

  it("no pide los filtros que robots.txt ya bloquea", async () => {
    const shop = fakeShop();
    await scanDomain("tienda.test", { fetcher: fetcherFor(shop.fetchImpl) });
    expect(shop.calls.some((c) => c.url.includes("order="))).toBe(false);
  });

  it("usa el user-agent de cada agente en las fichas", async () => {
    const shop = fakeShop();
    const { result } = await scanDomain("tienda.test", { fetcher: fetcherFor(shop.fetchImpl) });
    const product = result.pages.products[0]!;
    const uas = shop.calls.filter((c) => c.url === product).map((c) => c.ua);
    expect(uas).toEqual(expect.arrayContaining(Object.values(AGENTS).map((a) => a.userAgent)));
  });

  it("devuelve un resultado válido aunque la tienda no responda", async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
    };
    const { result } = await scanDomain("caida.test", { fetcher: fetcherFor(fetchImpl) });
    expect(ScanResultSchema.safeParse(result).success).toBe(true);
    expect(result.errors[0]).toMatch(/no responde/);
    expect(result.score.final).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Tienda.es/es/", "www.tienda.es"],
    ["tienda.es", "tienda.es"],
    ["http://tienda.es?x=1", "tienda.es"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

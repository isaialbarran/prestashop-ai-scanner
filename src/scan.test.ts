import { describe, expect, it } from "vitest";
import { AGENTS } from "../config/agents";
import { fakeShop } from "../test/shop";
import { createFetcher } from "./fetch/client";
import { DomainLimiter } from "./fetch/limiter";
import type { FetchImpl } from "./fetch/types";
import { normalizeDomain, scanDomain } from "./scan";
import { ScanResultSchema } from "./schema";

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

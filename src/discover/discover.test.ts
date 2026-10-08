import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import type { FetchResult } from "../fetch/types";
import { crawlDelayMs, interpretRobots, robotsVerdict } from "./robots";
import { classifyUrl, parseSitemap, preferLanguage, seededShuffle } from "./sitemap";

const ROBOTS_URL = "https://tienda.test/robots.txt";
const PRODUCT = "https://tienda.test/zapatillas/12-zapatilla-trail-ligera-2.html";

function res(status: number | null, body: string | null = ""): FetchResult {
  return {
    url: ROBOTS_URL,
    finalUrl: ROBOTS_URL,
    agent: "browser",
    attempt: 1,
    status,
    headers: {},
    body,
    bytes: body?.length ?? 0,
    truncated: false,
    redirects: [],
    ttfbMs: 100,
    totalMs: 120,
    error: status === null ? "ENOTFOUND" : null,
    fromCache: false,
  };
}

describe("robots", () => {
  it("permite las fichas con el robots.txt por defecto de PrestaShop y lee el Sitemap", () => {
    const info = interpretRobots(res(200, fixture("robots/allow-all.txt")), ROBOTS_URL);
    expect(robotsVerdict(info, PRODUCT, "Googlebot").allowed).toBe(true);
    expect(info.kind === "parsed" && info.sitemaps).toEqual(["https://tienda.test/1_index_sitemap.xml"]);
  });

  it("bloquea los filtros ?order= y ?q= del robots por defecto", () => {
    const info = interpretRobots(res(200, fixture("robots/allow-all.txt")), ROBOTS_URL);
    expect(robotsVerdict(info, "https://tienda.test/3-zapatillas?order=product.price.asc", "Googlebot").allowed).toBe(false);
    expect(robotsVerdict(info, "https://tienda.test/3-zapatillas?q=Talla-42", "OAI-SearchBot").allowed).toBe(false);
  });

  it("señala la línea que bloquea a un agente concreto", () => {
    const info = interpretRobots(res(200, fixture("robots/block-oai.txt")), ROBOTS_URL);
    expect(robotsVerdict(info, PRODUCT, "OAI-SearchBot")).toMatchObject({ allowed: false, line: 5, lineText: "Disallow: /" });
    expect(robotsVerdict(info, PRODUCT, "Googlebot").allowed).toBe(true);
  });

  it("aplica las reglas de Google a 404, 5xx y errores de red", () => {
    expect(robotsVerdict(interpretRobots(res(404), ROBOTS_URL), PRODUCT, "Googlebot").allowed).toBe(true);
    expect(robotsVerdict(interpretRobots(res(503), ROBOTS_URL), PRODUCT, "Googlebot").allowed).toBe(false);
    expect(robotsVerdict(interpretRobots(res(429), ROBOTS_URL), PRODUCT, "Googlebot").allowed).toBe(false);
    expect(robotsVerdict(interpretRobots(res(null, null), ROBOTS_URL), PRODUCT, "Googlebot").allowed).toBeNull();
  });

  it("lee el Crawl-delay más alto", () => {
    const info = interpretRobots(res(200, "User-agent: *\nCrawl-delay: 3\n\nUser-agent: Googlebot\nCrawl-delay: 5"), ROBOTS_URL);
    expect(crawlDelayMs(info, ["Googlebot"])).toBe(5000);
  });
});

describe("sitemap", () => {
  it("distingue índice y urlset y pone primero el idioma español", () => {
    const index = parseSitemap(fixture("sitemap/index.xml"));
    expect(index.kind).toBe("index");
    expect(preferLanguage(index.entries.map((e) => e.loc))[0]).toBe("https://tienda.test/1_es_0_sitemap.xml");
  });

  it("clasifica fichas y categorías con las rutas de PrestaShop", () => {
    const { kind, entries } = parseSitemap(fixture("sitemap/es.xml"));
    expect(kind).toBe("urlset");
    const byKind = (k: string) => entries.filter((e) => classifyUrl(e.loc, e.hasImage) === k).map((e) => e.loc);
    expect(byKind("product")).toEqual([
      "https://tienda.test/zapatillas/12-zapatilla-trail-ligera-2.html",
      "https://tienda.test/zapatillas/13-zapatilla-asfalto.html",
      "https://tienda.test/mochilas/31-mochila-urbana-20l.html",
      "https://tienda.test/mochilas/32-1-mochila-trail-12l.html",
      "https://tienda.test/index.php?id_product=40&controller=product&id_lang=1",
    ]);
    expect(byKind("category")).toEqual(["https://tienda.test/3-zapatillas", "https://tienda.test/4-mochilas"]);
  });

  it("acepta categorías con prefijo de idioma y descarta CMS y marcas", () => {
    expect(classifyUrl("https://t.test/es/3-zapatillas")).toBe("category");
    expect(classifyUrl("https://t.test/content/1-entrega")).toBe("other");
    expect(classifyUrl("https://t.test/2_montana")).toBe("other");
  });

  it("marca como inválido lo que no es un sitemap", () => {
    expect(parseSitemap("<html><body>404</body></html>").kind).toBe("invalid");
  });

  it("baraja siempre igual con la misma semilla", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(seededShuffle(items, "tienda.test")).toEqual(seededShuffle(items, "tienda.test"));
    expect(seededShuffle(items, "tienda.test")).not.toEqual(seededShuffle(items, "otra.test"));
    expect([...seededShuffle(items, "x")].sort()).toEqual(items);
  });
});

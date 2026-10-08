import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { fr, ORIGIN } from "../../test/snapshot";
import { createFetcher } from "../fetch/client";
import { DomainLimiter } from "../fetch/limiter";
import type { FetchImpl } from "../fetch/types";
import { assess, validateDomain } from "./validate";

const home = (body: string, over = {}) => fr(`${ORIGIN}/`, 200, body, over);
const sitemaps = [fr(`${ORIGIN}/1_index_sitemap.xml`, 200, fixture("sitemap/index.xml")), fr(`${ORIGIN}/1_es_0_sitemap.xml`, 200, fixture("sitemap/es.xml"))];

describe("assess", () => {
  it("acepta una tienda PrestaShop en español con fichas en el sitemap", () => {
    const a = assess("tienda.test", home(fixture("html/home.html")), sitemaps);
    expect(a).toMatchObject({ valid: true, version: "1.7 o posterior", lang: "es", sitemap: true, productUrls: 6 });
    expect(a.reasons).toEqual([]);
  });

  it("descarta lo que no es PrestaShop", () => {
    const a = assess("shopify.test", home(`<html lang="es"><body><a href="/products/x">x</a></body></html>`), []);
    expect(a.valid).toBe(false);
    expect(a.reasons).toContain("no se detecta PrestaShop");
  });

  it("descarta una tienda en otro idioma", () => {
    const a = assess("tienda.test", home(fixture("html/home.html").replace('lang="es"', 'lang="fr"')), sitemaps);
    expect(a.reasons).toContain("idioma de la portada: fr");
  });

  it("marca como no válida, con aviso, la portada protegida por un reto", () => {
    const a = assess("tienda.test", fr(`${ORIGIN}/`, 403, fixture("html/cloudflare-challenge.html"), { headers: { "cf-ray": "1", "cf-mitigated": "challenge" } }), []);
    expect(a.valid).toBe(false);
    expect(a.cloudflare).toBe(true);
    expect(a.warnings[0]).toMatch(/reto de cloudflare/);
  });

  it("solo avisa si la portada no declara idioma", () => {
    const a = assess("tienda.test", home(fixture("html/home.html").replace(' lang="es"', "")), sitemaps);
    expect(a.valid).toBe(true);
    expect(a.warnings).toContain("la portada no declara idioma");
  });

  it("descarta si no hay fichas localizables", () => {
    const a = assess("tienda.test", home(fixture("html/home.html")), []);
    expect(a.productUrls).toBe(2);
    expect(a.reasons).toContain("solo 2 fichas localizables");
  });
});

describe("validateDomain", () => {
  it("hace como mucho 4 peticiones y lee el sitemap del idioma español", async () => {
    const pages: Record<string, string> = {
      [`${ORIGIN}/`]: fixture("html/home.html"),
      [`${ORIGIN}/robots.txt`]: fixture("robots/allow-all.txt"),
      [`${ORIGIN}/1_index_sitemap.xml`]: fixture("sitemap/index.xml"),
      [`${ORIGIN}/1_es_0_sitemap.xml`]: fixture("sitemap/es.xml"),
    };
    const urls: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      urls.push(url);
      return pages[url] ? new Response(pages[url]) : new Response("404", { status: 404 });
    };
    const fetcher = createFetcher({ fetchImpl, limiter: new DomainLimiter({ minIntervalMs: 0, budget: 40 }) });
    const a = await validateDomain("tienda.test", fetcher);
    expect(a.valid).toBe(true);
    expect(urls).toEqual([`${ORIGIN}/`, `${ORIGIN}/robots.txt`, `${ORIGIN}/1_index_sitemap.xml`, `${ORIGIN}/1_es_0_sitemap.xml`]);
  });
});

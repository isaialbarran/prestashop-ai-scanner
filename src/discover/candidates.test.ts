import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { classicAt, fr, ORIGIN } from "../../test/snapshot";
import { analyzePage } from "../checks/context";
import { candidateCount, categoryFromProductPage, collectCandidates, productLinksFromPage } from "./candidates";
import { parseSitemap } from "./sitemap";

const page = (url: string, html: string) => analyzePage(fr(url, 200, html))!;
const home = () => page(`${ORIGIN}/`, fixture("html/home.html"));

describe("productLinksFromPage", () => {
  it("lee las miniaturas aunque la URL no tenga id y quita el fragmento de combinación", () => {
    expect(productLinksFromPage(home(), ORIGIN)).toEqual(["https://tienda.test/zapatilla-sin-id"]);
  });
});

describe("categoryFromProductPage", () => {
  it("toma la categoría de las migas JSON-LD", () => {
    const url = `${ORIGIN}/zapatillas/12-zapatilla-trail-ligera-2.html`;
    expect(categoryFromProductPage(page(url, classicAt(url)), ORIGIN)).toBe("https://tienda.test/3-zapatillas");
  });

  it("usa las migas HTML de 1.6 si no hay BreadcrumbList", () => {
    const url = "https://vieja.test/camisetas/7-camiseta-algodon-organico.html";
    const html = fixture("html/product-16.html").replace('&gt; Camisetas', '&gt; <a href="https://vieja.test/5-camisetas">Camisetas</a>');
    expect(categoryFromProductPage(page(url, html), "https://vieja.test")).toBe("https://vieja.test/5-camisetas");
  });
});

describe("collectCandidates", () => {
  it("pone primero las fichas del sitemap, luego las de la portada", () => {
    const c = collectCandidates([parseSitemap(fixture("sitemap/es.xml"))], home(), ORIGIN);
    expect(c.productTiers[0]).toHaveLength(5);
    expect(c.productTiers[1]).toEqual(["https://tienda.test/zapatilla-sin-id"]);
    expect(c.categories).toEqual(["https://tienda.test/3-zapatillas", "https://tienda.test/4-mochilas"]);
  });

  it("sin sitemap usa la portada", () => {
    const c = collectCandidates([], home(), ORIGIN);
    expect(candidateCount(c)).toBe(2);
  });

  it("como último recurso usa las entradas del sitemap con imagen", () => {
    const xml = `<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>${ORIGIN}/cafetera-espresso</loc><image:image><image:loc>${ORIGIN}/1.jpg</image:loc></image:image></url></urlset>`;
    const c = collectCandidates([parseSitemap(xml)], null, ORIGIN);
    expect(c.productTiers).toEqual([[`${ORIGIN}/cafetera-espresso`]]);
  });
});

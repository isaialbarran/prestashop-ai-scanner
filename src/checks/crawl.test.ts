import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { classicAt, fr, ORIGIN, product, PRODUCT_URLS, snapshot } from "../../test/snapshot";
import { CheckSchema } from "../schema";
import { runCheck } from "./index";

const ORDER_URL = `${ORIGIN}/3-zapatillas?order=product.price.asc`;
const Q_URL = `${ORIGIN}/3-zapatillas?q=Talla-42`;
const noFilters = fr(`${ORIGIN}/robots.txt`, 200, fixture("robots/no-filters.txt"));

describe("D1 sitemap", () => {
  it("pasa si el sitemap responde y robots.txt lo declara", () => {
    expect(CheckSchema.parse(runCheck("D1", snapshot()))).toMatchObject({ status: "pass", points: 4 });
  });

  it("da la mitad si el sitemap existe pero no está declarado", () => {
    expect(runCheck("D1", snapshot({ robots: noFilters }))).toMatchObject({ status: "hint", points: 2 });
  });

  it("falla sin sitemap ni declaración", () => {
    const sitemaps = [fr(`${ORIGIN}/1_index_sitemap.xml`, 404, "<html>404</html>")];
    expect(runCheck("D1", snapshot({ robots: noFilters, sitemaps }))).toMatchObject({ status: "fail", points: 0 });
  });
});

describe("D2 canonical y hreflang", () => {
  it("pasa con canonical propio y hreflang que se incluye a sí mismo", () => {
    expect(runCheck("D2", snapshot())).toMatchObject({ status: "pass", points: 3 });
  });

  it("resta si el canonical lleva parámetros de seguimiento", () => {
    const url = `${ORIGIN}/mochilas/31-mochila-urbana-20l.html`;
    const products = [product(url, fixture("html/product-conflict.html")), ...snapshot().products.slice(1)];
    const c = runCheck("D2", snapshot({ products }));
    expect(c.status).toBe("hint");
    expect(c.evidence[0]?.note).toMatch(/utm_source/);
  });

  it("resta si la tienda es multiidioma y la ficha no tiene hreflang", () => {
    const strip = (html: string) => html.replace(/<link rel="alternate" hreflang[^>]+>/g, "");
    const products = PRODUCT_URLS.map((url) => product(url, strip(classicAt(url))));
    expect(runCheck("D2", snapshot({ products })).points).toBe(2);
  });
});

describe("D3 filtros y ordenaciones", () => {
  it("pasa si robots.txt bloquea ?order= y ?q=", () => {
    const c = runCheck("D3", snapshot({ facets: { orderUrl: ORDER_URL, qUrl: Q_URL, order: null, q: null } }));
    expect(c).toMatchObject({ status: "pass", points: 3 });
  });

  it("pasa si no están bloqueadas pero el canonical apunta a la categoría limpia", () => {
    const category = fixture("html/category.html");
    const c = runCheck(
      "D3",
      snapshot({
        robots: noFilters,
        facets: { orderUrl: ORDER_URL, qUrl: Q_URL, order: fr(ORDER_URL, 200, category), q: fr(Q_URL, 200, category) },
      }),
    );
    expect(c).toMatchObject({ status: "pass", points: 3 });
  });

  it("falla si son rastreables y se canonicalizan a sí mismas", () => {
    const bad = fixture("html/category-ordered-noncanonical.html");
    const c = runCheck(
      "D3",
      snapshot({ robots: noFilters, facets: { orderUrl: ORDER_URL, qUrl: null, order: fr(ORDER_URL, 200, bad), q: null } }),
    );
    expect(c).toMatchObject({ status: "fail", points: 0 });
  });

  it("es inconcluso sin categoría", () => {
    expect(runCheck("D3", snapshot({ category: null })).status).toBe("inconclusive");
  });
});

describe("E1 TTFB", () => {
  const withTtfb = (values: number[]) =>
    snapshot({
      products: PRODUCT_URLS.map((url, i) =>
        product(url, classicAt(url), { browser: [fr(url, 200, classicAt(url), { ttfbMs: values[i]! })] }),
      ),
    });

  it("pasa con mediana por debajo de 800 ms", () => {
    expect(runCheck("E1", withTtfb([300, 500, 900]))).toMatchObject({ status: "pass", points: 4 });
  });

  it("falla con mediana de 800 ms o más", () => {
    const c = runCheck("E1", withTtfb([900, 1200, 300]));
    expect(c).toMatchObject({ status: "fail", points: 0 });
    expect(c.evidence[0]?.note).toMatch(/900 ms/);
  });
});

describe("E2 Core Web Vitals de campo", () => {
  const psi = (lcp: string, inp: string, cls: string) => ({
    requestedUrl: PRODUCT_URLS[0]!,
    source: "origin" as const,
    metrics: {
      lcp: { p75: 2100, category: lcp },
      inp: { p75: 150, category: inp },
      cls: { p75: 0.05, category: cls },
    },
    error: null,
  });

  it("pasa con las tres en verde", () => {
    expect(runCheck("E2", snapshot({ pagespeed: psi("FAST", "FAST", "FAST") }))).toMatchObject({ status: "pass", points: 6 });
  });

  it("resta la métrica que no está en verde", () => {
    expect(runCheck("E2", snapshot({ pagespeed: psi("SLOW", "FAST", "FAST") }))).toMatchObject({ status: "hint", points: 4 });
  });

  it("es inconcluso sin datos de campo o sin clave", () => {
    const empty = { requestedUrl: PRODUCT_URLS[0]!, source: null, metrics: { lcp: null, inp: null, cls: null }, error: null };
    expect(runCheck("E2", snapshot({ pagespeed: empty })).status).toBe("inconclusive");
    expect(runCheck("E2", snapshot({ pagespeed: null })).status).toBe("inconclusive");
  });
});

describe("I1–I3 informativos", () => {
  it("I1 detecta /.well-known/ucp", () => {
    const ucp = fr(`${ORIGIN}/.well-known/ucp`, 200, '{"version":"2026-01-11"}', { headers: { "content-type": "application/json" } });
    expect(runCheck("I1", snapshot({ ucp }))).toMatchObject({ status: "pass", points: 0, maxPoints: 0 });
    expect(runCheck("I1", snapshot()).status).toBe("hint");
  });

  it("I2 no confunde un 200 con HTML con un llms.txt", () => {
    const soft404 = fr(`${ORIGIN}/llms.txt`, 200, "<!doctype html><html><body>Página no encontrada</body></html>");
    expect(runCheck("I2", snapshot({ llms: soft404 })).status).toBe("hint");
    const real = fr(`${ORIGIN}/llms.txt`, 200, "# Tienda Test\n> Zapatillas de trail", { headers: { "content-type": "text/plain" } });
    expect(runCheck("I2", snapshot({ llms: real })).status).toBe("pass");
  });

  it("I3 distingue 1.7+ de 1.6", () => {
    expect(runCheck("I3", snapshot()).evidence[0]?.note).toMatch(/1\.7 o posterior/);
    const old = snapshot({
      home: fr(`${ORIGIN}/`, 200, fixture("html/product-16.html")),
      products: PRODUCT_URLS.map((url) => product(url, fixture("html/product-16.html"))),
    });
    const c = runCheck("I3", old);
    expect(c.status).toBe("hint");
    expect(c.evidence[0]?.note).toMatch(/1\.6/);
  });

  it("I3 es inconcluso si no parece PrestaShop", () => {
    const html = "<html><body><h1>Shopify</h1></body></html>";
    const c = runCheck("I3", snapshot({ home: fr(`${ORIGIN}/`, 200, html), products: PRODUCT_URLS.map((url) => product(url, html)) }));
    expect(c.status).toBe("inconclusive");
  });
});

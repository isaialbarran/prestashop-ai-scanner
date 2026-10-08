import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { canonicalOf, hreflangOf, loadHtml, visibleText } from "./html";
import { isValidGtin, parsePrice, productsOf } from "./product";
import { extractStructuredData, hasType, isOrganizationType } from "./structured";
import { visibleSignals } from "./visible";

const doc = (name: string) => loadHtml(fixture(`html/${name}`));

describe("visibleText", () => {
  it("quita scripts, estilos y head", () => {
    const text = visibleText(fixture("html/product-classic.html"));
    expect(text).toContain("Zapatilla trail Ligera 2");
    expect(text).not.toContain("prestashop");
    expect(text).not.toContain("schema.org");
  });
});

describe("extractStructuredData", () => {
  it("lee JSON-LD de varios bloques y detecta Breadcrumb y Organization", () => {
    const sd = extractStructuredData(doc("product-classic.html"));
    expect(sd.jsonLdBlocks).toBe(3);
    expect(sd.jsonLdErrors).toEqual([]);
    expect(hasType(sd, (t) => t.includes("BreadcrumbList"))).toBe(true);
    expect(hasType(sd, isOrganizationType)).toBe(true);
  });

  it("aplana @graph y no cuenta como bloque aparte el Product anidado en otro", () => {
    const $ = loadHtml(`<script type="application/ld+json">{"@graph":[
      {"@type":"WebPage","mainEntity":{"@type":"Product","name":"A","isRelatedTo":{"@type":"Product","name":"B"}}}
    ]}</script>`);
    const products = productsOf(extractStructuredData($));
    expect(products.map((p) => p.name)).toEqual(["A"]);
  });

  it("registra el JSON-LD roto sin lanzar", () => {
    const $ = loadHtml(`<script type="application/ld+json">{"@type":"Product","name":"A",}</script>`);
    const sd = extractStructuredData($);
    expect(sd.jsonLdErrors).toHaveLength(1);
    expect(productsOf(sd)).toEqual([]);
  });

  it("lee microdatos con Offer anidado", () => {
    const [product] = productsOf(extractStructuredData(doc("product-16.html")));
    expect(product).toMatchObject({
      source: "microdata",
      name: "Camiseta algodón orgánico",
      sku: "CAO-7",
      price: 19.95,
      currency: "EUR",
      availability: "InStock",
    });
  });

  it("encuentra los dos bloques en conflicto de la ficha con tema y módulo", () => {
    const products = productsOf(extractStructuredData(doc("product-conflict.html")));
    expect(products.map((p) => [p.source, p.price, p.availability])).toEqual([
      ["jsonld", 39.9, "InStock"],
      ["microdata", 34.9, "OutOfStock"],
    ]);
  });
});

describe("toProductMarkup", () => {
  it("normaliza identificadores, envío, devoluciones y valoraciones", () => {
    const [p] = productsOf(extractStructuredData(doc("product-classic.html")));
    expect(p).toMatchObject({
      name: "Zapatilla trail Ligera 2",
      sku: "ZTL2-42",
      mpn: "LIG2-BLK",
      brand: "Montaña",
      gtin: "8412345678905",
      gtinValid: true,
      price: 89.9,
      currency: "EUR",
      availability: "InStock",
      hasShipping: true,
      hasReturnPolicy: true,
      hasRating: true,
    });
  });
});

describe("parsePrice", () => {
  it.each([
    ["19.90", 19.9],
    ["19,90", 19.9],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.234", 1.234],
    ["89,90 €", 89.9],
    [12, 12],
    ["", null],
  ])("%s → %s", (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });
});

describe("isValidGtin", () => {
  it("valida el dígito de control", () => {
    expect(isValidGtin("8412345678905")).toBe(true);
    expect(isValidGtin("8412345678904")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("123")).toBe(false);
  });
});

describe("visibleSignals", () => {
  it("encuentra nombre, precio, disponibilidad, botón y descripción en el tema classic", () => {
    const s = visibleSignals(doc("product-classic.html"));
    expect(s.name).toBe("Zapatilla trail Ligera 2");
    expect(s.price?.text).toBe("89,90 €");
    expect(s.availability?.text).toMatch(/En stock/);
    expect(s.addToCart).toBe(true);
    expect(s.description?.text.length).toBeGreaterThan(300);
    expect(s.description?.heuristic).toBe(false);
  });

  it("funciona con el tema default-bootstrap de 1.6", () => {
    const s = visibleSignals(doc("product-16.html"));
    expect(s.price).toEqual({ text: "19,95 €", selector: "#our_price_display" });
    expect(s.availability?.text).toBe("Disponible");
    expect(s.addToCart).toBe(true);
  });

  it("no encuentra nada en una ficha que pinta con JavaScript", () => {
    const s = visibleSignals(doc("product-js-only.html"));
    expect(s).toMatchObject({ name: null, price: null, availability: null, addToCart: false });
  });

  it("detecta modo catálogo: sin precio ni botón de compra", () => {
    const s = visibleSignals(doc("product-catalog-mode.html"));
    expect(s.price).toBeNull();
    expect(s.addToCart).toBe(false);
  });
});

describe("canonical y hreflang", () => {
  it("resuelve URLs absolutas", () => {
    const $ = doc("product-classic.html");
    const base = "https://tienda.test/zapatillas/12-zapatilla-trail-ligera-2.html";
    expect(canonicalOf($, base)).toBe(base);
    expect(hreflangOf($, base).map((h) => h.lang)).toEqual(["es", "en", "x-default"]);
  });
});

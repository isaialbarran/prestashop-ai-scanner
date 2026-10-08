import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { classicAt, product, PRODUCT_URLS, snapshot } from "../../test/snapshot";
import { CheckSchema } from "../schema";
import { runCheck } from "./index";
import type { ExtractedProduct } from "./types";

const all = (html: string) => snapshot({ products: PRODUCT_URLS.map((url) => product(url, html)) });

describe("C1 un único bloque Product", () => {
  it("pasa con un bloque válido", () => {
    expect(CheckSchema.parse(runCheck("C1", snapshot()))).toMatchObject({ status: "pass", points: 8 });
  });

  it("pasa con microdatos de 1.6", () => {
    expect(runCheck("C1", all(fixture("html/product-16.html")))).toMatchObject({ status: "pass", points: 8 });
  });

  it("falla si tema y módulo publican bloques en conflicto", () => {
    const c = runCheck("C1", all(fixture("html/product-conflict.html")));
    expect(c).toMatchObject({ status: "fail", points: 0 });
    expect(c.evidence[0]?.note).toMatch(/conflicto/);
    expect(c.fix).toMatch(/microdatos|JSON-LD/);
  });

  it("da la mitad si hay dos bloques coherentes", () => {
    const html = classicAt(PRODUCT_URLS[0]!).replace(
      "</head>",
      `<script type="application/ld+json">{"@type":"Product","name":"Zapatilla trail Ligera 2","sku":"ZTL2-42","offers":{"price":"89.90","priceCurrency":"EUR"}}</script></head>`,
    );
    expect(runCheck("C1", all(html))).toMatchObject({ status: "hint", points: 4 });
  });

  it("falla si no hay Product", () => {
    expect(runCheck("C1", all(fixture("html/product-js-only.html")))).toMatchObject({ status: "fail", points: 0 });
  });
});

describe("C2 Offer igual a lo visible", () => {
  it("queda inconcluso hasta que exista extract.ts", () => {
    const c = runCheck("C2", snapshot());
    expect(CheckSchema.parse(c).status).toBe("inconclusive");
    expect(c.evidence[0]?.note).toMatch(/extract/);
  });

  const visible = (over: Partial<ExtractedProduct> = {}): ExtractedProduct => ({
    name: "Zapatilla trail Ligera 2",
    price: 89.9,
    currency: "EUR",
    availability: "InStock",
    gtin: null,
    brand: null,
    ...over,
  });

  it("pasa si precio, moneda y disponibilidad coinciden", () => {
    expect(runCheck("C2", snapshot({ extracted: [visible(), visible(), visible()] }))).toMatchObject({ status: "pass", points: 12 });
  });

  it("trata como iguales disponibilidades de la misma clase (InStock y LimitedAvailability)", () => {
    const c = runCheck("C2", snapshot({ extracted: [visible({ availability: "LimitedAvailability" }), visible(), visible()] }));
    expect(c).toMatchObject({ status: "pass", points: 12 });
  });

  it("marca la discrepancia entre disponible y agotado", () => {
    const c = runCheck("C2", snapshot({ extracted: [visible({ availability: "OutOfStock" }), visible(), visible()] }));
    expect(c.status).toBe("hint");
  });

  it("resta el campo que no coincide", () => {
    const c = runCheck("C2", snapshot({ extracted: [visible({ price: 99.9 }), visible(), visible()] }));
    expect(c.status).toBe("hint");
    expect(c.points).toBeCloseTo(10.67, 2);
    expect(c.evidence.some((e) => /89\.9.*99\.9|99\.9.*89\.9/.test(e.note))).toBe(true);
  });
});

describe("C3 identificadores", () => {
  it("pasa con gtin válido, marca y sku", () => {
    expect(runCheck("C3", snapshot())).toMatchObject({ status: "pass", points: 8 });
  });

  it("da la mitad sin gtin ni mpn", () => {
    expect(runCheck("C3", all(fixture("html/product-conflict.html")))).toMatchObject({ status: "hint", points: 4 });
  });

  it("no cuenta un gtin con dígito de control incorrecto", () => {
    const html = classicAt(PRODUCT_URLS[0]!).replace('"gtin13": "8412345678905"', '"gtin13": "8412345678904"').replace('"mpn": "LIG2-BLK",', "");
    const c = runCheck("C3", all(html));
    expect(c.points).toBe(4);
    expect(c.evidence[0]?.note).toMatch(/dígito de control/);
  });
});

describe("C4 envío, devoluciones y valoraciones", () => {
  it("pasa con los tres", () => {
    expect(runCheck("C4", snapshot())).toMatchObject({ status: "pass", points: 4 });
  });

  it("falla sin ninguno", () => {
    expect(runCheck("C4", all(fixture("html/product-conflict.html")))).toMatchObject({ status: "fail", points: 0 });
  });
});

describe("C5 migas y organización", () => {
  it("pasa con BreadcrumbList y Organization", () => {
    expect(runCheck("C5", snapshot())).toMatchObject({ status: "pass", points: 3 });
  });

  it("cuenta la Organization de la portada", () => {
    expect(runCheck("C5", all(fixture("html/product-16.html")))).toMatchObject({ status: "hint", points: 1 });
  });
});

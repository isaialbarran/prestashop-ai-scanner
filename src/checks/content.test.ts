import { describe, expect, it } from "vitest";
import { fixture } from "../../test/fixtures";
import { classicAt, product, PRODUCT_URLS, snapshot } from "../../test/snapshot";
import { CheckSchema } from "../schema";
import { runCheck } from "./index";

const mixed = () =>
  snapshot({
    products: [
      product(PRODUCT_URLS[0]!, classicAt(PRODUCT_URLS[0]!)),
      product(PRODUCT_URLS[1]!, fixture("html/product-js-only.html")),
      product(PRODUCT_URLS[2]!, fixture("html/product-16.html")),
    ],
  });

describe("B1 nombre, precio y disponibilidad", () => {
  it("pasa con el tema classic", () => {
    expect(CheckSchema.parse(runCheck("B1", snapshot()))).toMatchObject({ status: "pass", points: 10 });
  });

  it("promedia las tres fichas", () => {
    const c = runCheck("B1", mixed());
    expect(c.status).toBe("hint");
    expect(c.points).toBeCloseTo(6.67, 2);
    expect(c.evidence).toHaveLength(3);
  });
});

describe("B2 descripción", () => {
  it("pasa con 300 caracteres o más", () => {
    expect(runCheck("B2", snapshot())).toMatchObject({ status: "pass", points: 5 });
  });

  it("da puntos proporcionales a una descripción corta", () => {
    const products = PRODUCT_URLS.map((url) => product(url, fixture("html/product-conflict.html")));
    const c = runCheck("B2", snapshot({ products }));
    expect(c.status).toBe("hint");
    expect(c.points).toBeGreaterThan(0);
    expect(c.points).toBeLessThan(2);
  });

  it("falla si no hay descripción en el HTML", () => {
    const products = PRODUCT_URLS.map((url) => product(url, fixture("html/product-js-only.html")));
    expect(runCheck("B2", snapshot({ products }))).toMatchObject({ status: "fail", points: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { parseDomains, percentile } from "./csv";

describe("parseDomains", () => {
  it("lee la primera columna, normaliza y quita cabecera, comentarios y duplicados", () => {
    const csv = ["dominio;sector", "https://www.Tienda-A.es/es/;moda", "# pendiente", "", "tienda-b.com,deporte", "tienda-a.es", "sin-punto"].join("\n");
    expect(parseDomains(csv)).toEqual(["www.tienda-a.es", "tienda-b.com", "tienda-a.es"]);
  });
});

describe("percentile", () => {
  it("calcula p50 y p95 por rango más cercano", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });
});

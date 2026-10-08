import { describe, expect, it } from "vitest";
import { fakeLlm } from "../../test/llm";
import { fr, ORIGIN, snapshot } from "../../test/snapshot";
import { fixture } from "../../test/fixtures";
import { buildQueryContext, generateQueries, mentionsStore, sanitizeQuery, storeNames } from "./queries";

describe("storeNames", () => {
  it("junta dominio, Organization y el nombre corto del título, sin palabras genéricas", () => {
    const names = storeNames(snapshot());
    expect(names).toEqual(expect.arrayContaining(["tienda.test", "Tienda Test"]));
    expect(names).not.toContain("tienda");
  });

  it("toma og:site_name y descarta palabras genéricas", () => {
    const html = fixture("html/home.html").replace("<title>Tienda Test</title>", '<title>Inicio | FITmask</title><meta property="og:site_name" content="FITmask">');
    const names = storeNames(snapshot({ home: fr(`${ORIGIN}/`, 200, html), origin: "https://www.fitmask.es" }));
    expect(names).toEqual(expect.arrayContaining(["fitmask.es", "fitmask", "FITmask"]));
    expect(names).not.toContain("Inicio");
  });
});

describe("sanitizeQuery", () => {
  const names = ["fitmask.es", "fitmask", "Lylo Tools", "lylotools"];

  it("quita la marca propia de la tienda pegada o separada", () => {
    expect(sanitizeQuery("mascarilla deportiva FITmask lavable", names)).toEqual({ text: "mascarilla deportiva lavable", changed: true });
    expect(sanitizeQuery("dónde comprar sellos de arcilla en Lylo Tools", names).text).toBe("dónde comprar sellos de arcilla");
    expect(sanitizeQuery("tinta de alcohol en lylotools.es", names).text).toBe("tinta de alcohol");
  });

  it("no confunde una palabra que solo contiene el nombre", () => {
    expect(sanitizeQuery("expositores de decoración para tienda", ["ecor.es", "ecor"]).changed).toBe(false);
  });

  it("no toca consultas limpias", () => {
    expect(sanitizeQuery("mejor freidora de aire para 4 personas", names)).toEqual({ text: "mejor freidora de aire para 4 personas", changed: false });
    expect(mentionsStore("mejor freidora de aire", names)).toBe(false);
  });
});

describe("generateQueries", () => {
  it("devuelve 4 + 4 + 2 consultas numeradas y sin el nombre de la tienda", async () => {
    const llm = fakeLlm({
      structured: (req) => {
        expect(req.user).toContain("Nunca menciones la tienda");
        return {
          category: ["mejor zapatilla de trail para principiantes", "mejores zapatillas trail baratas", "zapatillas de trail para barro", "zapatillas trail mujer ligeras"],
          product: ["zapatilla trail drop 6 mm 260 g", "zapatilla trail suela tacos 5 mm", "zapatilla trail malla transpirable", "zapatillas trail Tienda Test talla 42"],
          purchase: ["dónde comprar zapatillas de trail en España", "comprar zapatillas trail online España"],
        };
      },
    });
    const { queries } = await generateQueries(buildQueryContext(snapshot()), llm);
    expect(queries.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"]);
    expect(queries.filter((q) => q.kind === "purchase")).toHaveLength(2);
    expect(queries[7]).toMatchObject({ text: "zapatillas trail talla 42", sanitized: true });
  });

  it("falla si el modelo devuelve menos consultas de las pedidas", async () => {
    const llm = fakeLlm({ structured: () => ({ category: ["a"], product: [], purchase: [] }) });
    await expect(generateQueries(buildQueryContext(snapshot()), llm)).rejects.toThrow(/consultas de tipo category/);
  });
});

describe("buildQueryContext", () => {
  it("usa categoría, nombres y atributos de las fichas", () => {
    const ctx = buildQueryContext(snapshot());
    expect(ctx.category).toBe("Zapatillas");
    expect(ctx.products[0]).toMatchObject({ name: "Zapatilla trail Ligera 2", attributes: ["Peso: 260 g", "Drop: 6 mm"] });
  });
});

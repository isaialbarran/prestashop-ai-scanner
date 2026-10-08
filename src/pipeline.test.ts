import { describe, expect, it } from "vitest";
import { fakeLlm } from "../test/llm";
import { fakeShop, O } from "../test/shop";
import { createFetcher } from "./fetch/client";
import { DomainLimiter } from "./fetch/limiter";
import { CostLedger } from "./llm/cost";
import type { StructuredRequest } from "./llm/types";
import { runReport } from "./pipeline";
import { ReportResultSchema } from "./schema";

function scriptedLlm(ledger?: CostLedger) {
  return fakeLlm(
    {
      structured: (req: StructuredRequest<unknown>) => {
        switch (req.purpose) {
          case "extraction":
            return { name: "Zapatilla trail Ligera 2", price: 89.9, currency: "EUR", availability: "InStock", gtin: null, brand: "Montaña" };
          case "queries":
            return {
              category: ["mejor zapatilla de trail", "zapatillas trail baratas", "zapatillas trail barro", "zapatillas trail mujer"],
              product: ["zapatilla trail drop 6 mm", "zapatilla trail 260 g", "zapatilla trail tacos 5 mm", "zapatilla trail malla"],
              purchase: ["dónde comprar zapatillas de trail en España", "comprar zapatillas trail online"],
            };
          case "detection":
            return { mentioned: false, quote: null };
          case "report":
            return {
              headline: "La tienda aparece en 1 de 20 respuestas [q1].",
              findings: ["Faltan envío, devoluciones y valoraciones en una ficha [C4].", "Decathlon aparece donde tú no [q2].", "El robots.txt deja pasar a los rastreadores [A1]."],
            };
        }
      },
      search: (provider, query) =>
        provider === "openai" && query === "mejor zapatilla de trail"
          ? { text: "Mira tienda.test.", cited: [{ url: `${O}/zapatillas/12-zapatilla-trail-ligera-2.html`, title: null, domain: "tienda.test" }] }
          : { text: "Decathlon.", cited: [{ url: "https://www.decathlon.es/x", title: null, domain: "decathlon.es" }] },
    },
    ledger,
  );
}

describe("runReport", () => {
  it("produce un informe válido de punta a punta, con C2 evaluado y coste registrado", async () => {
    const ledger = new CostLedger(2);
    const llm = scriptedLlm(ledger);
    const fetcher = createFetcher({ fetchImpl: fakeShop().fetchImpl, limiter: new DomainLimiter({ minIntervalMs: 0, budget: 40 }) });

    const { result } = await runReport("tienda.test", { fetcher, llm, ledger });

    expect(ReportResultSchema.safeParse(result).success).toBe(true);
    expect(result.extraction.filter((e) => e.data)).toHaveLength(3);
    expect(result.scan.checks.find((c) => c.id === "C2")?.status).not.toBe("inconclusive");
    expect(result.visibility).toMatchObject({ total: 20, citedIn: 1 });
    expect(result.visibility.topCompetitors[0]).toEqual({ domain: "decathlon.es", answers: 19 });
    expect(result.report.findings).toHaveLength(3);
    expect(result.cost.llmCalls).toBe(llm.calls.length);
    expect(result.cost.byPurpose.visibility).toMatchObject({ calls: 20 });
    expect(result.cost.totalUsd).toBeCloseTo(llm.calls.length * 0.001, 6);
    expect(llm.calls.map((c) => c.purpose).sort()).toEqual(
      expect.arrayContaining(["extraction", "queries", "visibility", "detection", "report"]),
    );
  });

  it("falla con un mensaje claro si no hay fichas", async () => {
    const fetchImpl = async () => new Response("<html><body>vacía</body></html>", { status: 200 });
    const fetcher = createFetcher({ fetchImpl, limiter: new DomainLimiter({ minIntervalMs: 0, budget: 40 }) });
    await expect(runReport("vacia.test", { fetcher, llm: scriptedLlm(), ledger: new CostLedger(2) })).rejects.toThrow(/sin fichas/);
  });
});

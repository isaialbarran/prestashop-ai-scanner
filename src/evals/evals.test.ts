import { describe, expect, it } from "vitest";
import type { ExtractedProduct } from "../checks/types";
import type { ReportResult } from "../schema";
import { ChecksLabelSchema, DetectionLabelSchema, ExtractionLabelSchema } from "./datasets";
import { costLatency, countDiscrepancies, extractionAccuracy, fieldMatches, precisionRecall, rawEvidenceCoverage, stability } from "./metrics";

const truth = (over: Partial<ExtractedProduct> = {}): ExtractedProduct => ({
  name: "Arcilla polimérica Sculpey Premo - granada",
  price: 2.8,
  currency: "EUR",
  availability: "InStock",
  gtin: "0715891502624",
  brand: "Sculpey",
  ...over,
});

describe("etiquetas desde la hoja de cálculo", () => {
  it("acepta sí/no, vacíos y decimales con coma", () => {
    expect(
      ExtractionLabelSchema.parse({ id: "x:0", domain: "x", productIndex: "0", url: "u", name: "A", price: "4,55", currency: "eur", availability: "", gtin: "", brand: "B", note: "" }),
    ).toMatchObject({ productIndex: 0, price: 4.55, currency: "EUR", availability: null, gtin: null, note: null });
    expect(DetectionLabelSchema.parse({ id: "i", report: "r", domain: "d", queryId: "q1", provider: "openai", label: "Sí", note: "" }).label).toBe(true);
  });

  it("en checks, si estás de acuerdo el estado correcto es el del escáner; si no, es obligatorio", () => {
    const base = { id: "d:A2", domain: "d", check: "A2", scannerStatus: "fail", note: "" };
    expect(ChecksLabelSchema.parse({ ...base, agree: "si", correctStatus: "" }).correctStatus).toBe("fail");
    expect(ChecksLabelSchema.parse({ ...base, agree: "no", correctStatus: "inconclusive" }).correctStatus).toBe("inconclusive");
    expect(ChecksLabelSchema.safeParse({ ...base, agree: "no", correctStatus: "" }).success).toBe(false);
  });
});

describe("métricas", () => {
  it("cuenta discrepancias por check", () => {
    expect(
      countDiscrepancies([
        { check: "A2", current: "pass", correct: "pass" },
        { check: "A2", current: "fail", correct: "inconclusive" },
        { check: "C3", current: "hint", correct: "hint" },
      ]),
    ).toEqual({ A2: { total: 2, discrepancies: 1 }, C3: { total: 1, discrepancies: 0 } });
  });

  it("compara campos con normalización mínima", () => {
    expect(fieldMatches("name", truth(), truth({ name: "arcilla polimerica sculpey premo granada" }))).toBe(true);
    expect(fieldMatches("price", truth(), truth({ price: 2.804 }))).toBe(true);
    expect(fieldMatches("price", truth(), truth({ price: 2.81 }))).toBe(false);
    expect(fieldMatches("gtin", truth({ gtin: null }), truth({ gtin: null }))).toBe(true);
    expect(fieldMatches("availability", truth(), null)).toBe(false);
  });

  it("calcula el acierto por campo", () => {
    const acc = extractionAccuracy([
      { truth: truth(), pred: truth() },
      { truth: truth(), pred: truth({ price: 3 }) },
    ]);
    expect(acc.price.accuracy).toBe(0.5);
    expect(acc.name.accuracy).toBe(1);
  });

  it("calcula precisión y recall", () => {
    expect(
      precisionRecall([
        { label: true, pred: true },
        { label: true, pred: false },
        { label: false, pred: true },
        { label: false, pred: false },
      ]),
    ).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 1, precision: 0.5, recall: 0.5 });
  });

  it("mide la cobertura automática de referencias del borrador", () => {
    const r = rawEvidenceCoverage([{ model: "m", headline: "A [C4]. B [q1].", findings: ["C [A2]."], dropped: ["Sin referencia."] }]);
    expect(r).toEqual({ kept: 3, dropped: 1, share: 0.75 });
  });
});

const report = (domain: string, index: number, cited: Record<string, boolean>, over: Partial<ReportResult> = {}) =>
  ({
    domain,
    run: { tag: "stability", index },
    visibility: {
      citedIn: Object.values(cited).filter(Boolean).length,
      answers: Object.entries(cited).map(([key, c]) => ({ queryId: key.split("|")[0], provider: key.split("|")[1], cited: c, error: null })),
    },
    cost: { totalEur: 0.6, cachedCalls: 0 },
    scan: { requests: { cached: 0 } },
    latencyMs: 90_000,
    ...over,
  }) as unknown as ReportResult;

describe("estabilidad y coste", () => {
  it("mide la variación de citedIn y el acuerdo por par consulta–proveedor", () => {
    const s = stability([
      report("a.es", 1, { "q1|openai": true, "q2|openai": false }),
      report("a.es", 2, { "q1|openai": true, "q2|openai": true }),
      report("a.es", 3, { "q1|openai": true, "q2|openai": false }),
    ]);
    expect(s.perDomain[0]).toMatchObject({ domain: "a.es", citedIn: [1, 2, 1], range: 1 });
    expect(s.pairAgreement).toBe(0.5);
  });

  it("solo usa para la latencia los informes en frío", () => {
    const c = costLatency([
      report("a.es", 1, {}, { cost: { totalEur: 0.5, cachedCalls: 0 } as ReportResult["cost"], latencyMs: 80_000 }),
      report("a.es", 2, {}, { cost: { totalEur: 0.7, cachedCalls: 12 } as ReportResult["cost"], latencyMs: 20_000 }),
    ]);
    expect(c).toMatchObject({ reports: 2, coldReports: 1, latencyP95: 80 });
    expect(c.costP95).toBe(0.7);
  });
});

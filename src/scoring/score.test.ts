import { describe, expect, it } from "vitest";
import { CHECKS } from "../checks/catalog";
import { CHECK_IDS, ScoreSchema, type Check, type CheckId } from "../schema";
import { bandFor, computeScore } from "./score";

function checks(over: Partial<Record<CheckId, Partial<Check>>> = {}): Check[] {
  return CHECK_IDS.map((id) => ({
    id,
    title: CHECKS[id].title,
    status: "pass",
    points: CHECKS[id].maxPoints,
    maxPoints: CHECKS[id].maxPoints,
    evidence: [{ url: "https://t.test/", note: "ok" }],
    fix: null,
    ...over[id],
  }));
}

describe("computeScore", () => {
  it("da 100 si todo pasa", () => {
    const s = computeScore(checks());
    expect(ScoreSchema.parse(s)).toMatchObject({ final: 100, band: "preparada", coverage: 1, cap: null });
  });

  it("reescala sobre los puntos evaluados y publica la cobertura", () => {
    const s = computeScore(checks({ C2: { status: "inconclusive", points: 0 }, E2: { status: "inconclusive", points: 0 } }));
    expect(s.evaluated).toBe(82);
    expect(s.coverage).toBeCloseTo(0.82, 2);
    expect(s.final).toBe(100);
  });

  it("suma puntos parciales", () => {
    const s = computeScore(checks({ A2: { status: "hint", points: 7.5 }, C1: { status: "fail", points: 0 } }));
    expect(s.earned).toBe(84.5);
    expect(s.final).toBe(85);
  });

  it("topa en 40 si A1 bloquea a OAI-SearchBot", () => {
    const s = computeScore(checks({ A1: { status: "hint", points: 6.67, perAgent: { "oai-searchbot": "fail", googlebot: "pass" } } }));
    expect(s.cap).toBe(40);
    expect(s.final).toBe(40);
    expect(s.band).toBe("ilegible");
    expect(s.capReasons[0]).toMatch(/A1.*OAI-SearchBot/);
  });

  it("topa en 40 si A2 falla en origen para Googlebot", () => {
    const s = computeScore(
      checks({ A2: { status: "hint", points: 11.25, perAgent: { googlebot: "fail" }, blockKind: { googlebot: "origen" } } }),
    );
    expect(s.cap).toBe(40);
    expect(s.capReasons[0]).toMatch(/A2.*Googlebot/);
  });

  it("no topa si el fallo de A2 es de WAF (indicio)", () => {
    const s = computeScore(checks({ A2: { status: "hint", points: 11.25, perAgent: { googlebot: "fail" }, blockKind: { googlebot: "waf" } } }));
    expect(s.cap).toBeNull();
    expect(s.final).toBe(96);
  });

  it("no topa por PerplexityBot", () => {
    expect(computeScore(checks({ A1: { status: "hint", points: 6.67, perAgent: { perplexitybot: "fail" } } })).cap).toBeNull();
  });

  it("deja la nota en null si nada es concluyente", () => {
    const all = Object.fromEntries(CHECK_IDS.map((id) => [id, { status: "inconclusive" as const, points: 0 }]));
    expect(computeScore(checks(all))).toMatchObject({ final: null, band: null, coverage: 0 });
  });
});

describe("bandFor", () => {
  it.each([
    [0, "ilegible"],
    [49, "ilegible"],
    [50, "legible con errores"],
    [79, "legible con errores"],
    [80, "preparada"],
    [100, "preparada"],
  ])("%i → %s", (score, band) => {
    expect(bandFor(score)).toBe(band);
  });
});

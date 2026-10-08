import { describe, expect, it } from "vitest";
import { CHECK_IDS, CheckSchema, ScanResultSchema, type Check, type ScanResult } from "./schema";
import { CHECKS } from "./checks/catalog";

const check = (id: (typeof CHECK_IDS)[number], over: Partial<Check> = {}): Check => ({
  id,
  title: CHECKS[id].title,
  status: "pass",
  points: CHECKS[id].maxPoints,
  maxPoints: CHECKS[id].maxPoints,
  evidence: [{ url: "https://tienda.test/", note: "ok" }],
  fix: null,
  ...over,
});

const result = (over: Partial<ScanResult> = {}): ScanResult => ({
  id: "6f1c2b0e-3a4d-4e5f-8a9b-0c1d2e3f4a5b",
  domain: "tienda.test",
  origin: "https://tienda.test",
  scannedAt: "2026-10-08T10:00:00.000Z",
  scannerVersion: "0.1.0",
  platform: { prestashop: true, version: "1.7+" },
  pages: { home: "https://tienda.test/", category: null, products: [] },
  checks: CHECK_IDS.map((id) => check(id)),
  score: {
    earned: 100,
    evaluated: 100,
    possible: 100,
    coverage: 1,
    normalized: 100,
    cap: null,
    capReasons: [],
    final: 100,
    band: "preparada",
  },
  requests: { network: 20, cached: 0, budget: 40 },
  durationMs: 1000,
  errors: [],
  ...over,
});

describe("schema", () => {
  it("el catálogo suma 100 puntos", () => {
    expect(Object.values(CHECKS).reduce((s, c) => s + c.maxPoints, 0)).toBe(100);
  });

  it("acepta un ScanResult completo", () => {
    expect(ScanResultSchema.safeParse(result()).success).toBe(true);
  });

  it("exige cada check exactamente una vez", () => {
    const checks = CHECK_IDS.map((id) => check(id));
    checks[1] = check("A1");
    expect(ScanResultSchema.safeParse(result({ checks })).success).toBe(false);
  });

  it("rechaza más puntos que el máximo", () => {
    expect(CheckSchema.safeParse(check("A1", { points: 11 })).success).toBe(false);
  });

  it("exige al menos una evidencia", () => {
    expect(CheckSchema.safeParse(check("A1", { evidence: [] })).success).toBe(false);
  });
});

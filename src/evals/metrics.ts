import { percentile } from "../batch/csv";
import type { ExtractedProduct } from "../checks/types";
import type { CheckStatus, ReportResult, ReportText } from "../schema";

// ── Checks deterministas ──────────────────────────────────────────────────────

export function countDiscrepancies(rows: { check: string; current: CheckStatus; correct: CheckStatus }[]) {
  const out: Record<string, { total: number; discrepancies: number }> = {};
  for (const r of rows) {
    out[r.check] ??= { total: 0, discrepancies: 0 };
    out[r.check]!.total++;
    if (r.current !== r.correct) out[r.check]!.discrepancies++;
  }
  return out;
}

// ── Extracción ────────────────────────────────────────────────────────────────

export const FIELDS = ["name", "price", "currency", "availability", "gtin", "brand"] as const;
export type Field = (typeof FIELDS)[number];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Acierto exacto por campo, con normalización mínima (mayúsculas, acentos, espacios; precio a ±0,005). */
export function fieldMatches(field: Field, truth: ExtractedProduct, pred: ExtractedProduct | null): boolean {
  const t = truth[field];
  const p = pred ? pred[field] : null;
  if (t === null || p === null) return t === null && p === null;
  switch (field) {
    case "price":
      return Math.abs(Number(t) - Number(p)) < 0.005;
    case "currency":
    case "availability":
      return String(t).toUpperCase() === String(p).toUpperCase();
    case "gtin":
      return String(t).replace(/\D/g, "") === String(p).replace(/\D/g, "");
    default:
      return norm(String(t)) === norm(String(p));
  }
}

export function extractionAccuracy(pairs: { truth: ExtractedProduct; pred: ExtractedProduct | null }[]) {
  return Object.fromEntries(
    FIELDS.map((f) => {
      const correct = pairs.filter((p) => fieldMatches(f, p.truth, p.pred)).length;
      return [f, { correct, total: pairs.length, accuracy: pairs.length ? correct / pairs.length : 0 }];
    }),
  ) as Record<Field, { correct: number; total: number; accuracy: number }>;
}

// ── Detección de citas ────────────────────────────────────────────────────────

export function precisionRecall(pairs: { label: boolean; pred: boolean }[]) {
  const tp = pairs.filter((p) => p.label && p.pred).length;
  const fp = pairs.filter((p) => !p.label && p.pred).length;
  const fn = pairs.filter((p) => p.label && !p.pred).length;
  const tn = pairs.filter((p) => !p.label && !p.pred).length;
  return {
    tp,
    fp,
    fn,
    tn,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
  };
}

// ── Fidelidad del informe ─────────────────────────────────────────────────────

export function fidelityShare(rows: { supported: boolean }[]) {
  const supported = rows.filter((r) => r.supported).length;
  return { supported, total: rows.length, share: rows.length ? supported / rows.length : 0 };
}

/** Métrica automática secundaria: frases del borrador del modelo que ya traían referencias válidas. */
export function rawEvidenceCoverage(reports: ReportText[]) {
  const sentences = (t: string | null) => (t ? t.split(/(?<=\])\s+(?=\S)|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/u).filter(Boolean).length : 0);
  const kept = reports.reduce((s, r) => s + sentences(r.headline) + r.findings.reduce((a, f) => a + sentences(f), 0), 0);
  const dropped = reports.reduce((s, r) => s + r.dropped.length, 0);
  return { kept, dropped, share: kept + dropped ? kept / (kept + dropped) : 1 };
}

// ── Estabilidad ───────────────────────────────────────────────────────────────

export function stability(reports: ReportResult[]) {
  const byDomain = new Map<string, ReportResult[]>();
  for (const r of reports) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r]);

  const perDomain = [...byDomain.entries()]
    .filter(([, runs]) => runs.length >= 2)
    .map(([domain, runs]) => {
      const ordered = [...runs].sort((a, b) => (a.run.index ?? 0) - (b.run.index ?? 0));
      const cited = ordered.map((r) => r.visibility.citedIn);
      const mean = cited.reduce((a, b) => a + b, 0) / cited.length;
      const std = Math.sqrt(cited.reduce((a, b) => a + (b - mean) ** 2, 0) / cited.length);
      return { domain, runs: ordered.length, citedIn: cited, range: Math.max(...cited) - Math.min(...cited), std };
    });

  // Pares consulta–proveedor: ¿la tienda sale citada (o no) en todas las ejecuciones?
  let pairs = 0;
  let agreeing = 0;
  for (const [, runs] of byDomain) {
    if (runs.length < 2) continue;
    const keys = new Set(runs.flatMap((r) => r.visibility.answers.map((a) => `${a.queryId}|${a.provider}`)));
    for (const key of keys) {
      const values = runs
        .map((r) => r.visibility.answers.find((a) => `${a.queryId}|${a.provider}` === key))
        .filter((a) => a && !a.error)
        .map((a) => a!.cited);
      if (values.length < 2) continue;
      pairs++;
      if (values.every((v) => v === values[0])) agreeing++;
    }
  }

  return {
    perDomain,
    meanRange: perDomain.length ? perDomain.reduce((s, d) => s + d.range, 0) / perDomain.length : 0,
    meanStd: perDomain.length ? perDomain.reduce((s, d) => s + d.std, 0) / perDomain.length : 0,
    pairAgreement: pairs ? agreeing / pairs : 1,
    pairs,
  };
}

// ── Coste y latencia ──────────────────────────────────────────────────────────

/** Coste de todos los informes; latencia solo de los que corrieron en frío (sin caché HTTP ni LLM). */
export function costLatency(reports: ReportResult[]) {
  const cost = reports.map((r) => r.cost.totalEur);
  const cold = reports.filter((r) => r.cost.cachedCalls === 0 && r.scan.requests.cached === 0);
  const secs = cold.map((r) => r.latencyMs / 1000);
  return {
    reports: reports.length,
    costP50: percentile(cost, 50),
    costP95: percentile(cost, 95),
    coldReports: cold.length,
    latencyP50: percentile(secs, 50),
    latencyP95: percentile(secs, 95),
  };
}

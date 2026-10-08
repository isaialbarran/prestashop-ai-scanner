import { AGENTS, CAP_AGENTS } from "../../config/agents";
import { BANDS, MIN_COVERAGE, SCORE_CAP } from "../../config/scanner";
import { round2 } from "../checks/helpers";
import type { Band, Check, Score } from "../schema";

export function bandFor(score: number): Band {
  return BANDS.find((b) => score >= b.min)!.band;
}

/**
 * Nota técnica:
 * - Los checks inconclusos no cuentan: la nota se reescala sobre los puntos evaluados y se publica la cobertura.
 *   Con cobertura por debajo de MIN_COVERAGE no hay nota (final y band a null).
 * - Tope de 40 si A1 bloquea a OAI-SearchBot o a Googlebot, o si A2 falla para ellos por rechazo del propio
 *   servidor. Un fallo de A2 con firma de WAF es un indicio (el WAF puede verificar por IP) y no topa.
 */
export function computeScore(checks: Check[]): Score {
  const scored = checks.filter((c) => c.maxPoints > 0);
  const conclusive = scored.filter((c) => c.status !== "inconclusive");
  const possible = scored.reduce((s, c) => s + c.maxPoints, 0);
  const evaluated = conclusive.reduce((s, c) => s + c.maxPoints, 0);
  const earned = conclusive.reduce((s, c) => s + c.points, 0);

  const capReasons: string[] = [];
  const a1 = checks.find((c) => c.id === "A1");
  const a2 = checks.find((c) => c.id === "A2");
  for (const agent of CAP_AGENTS) {
    const label = AGENTS[agent].label;
    if (a1?.perAgent?.[agent] === "fail") capReasons.push(`A1: robots.txt bloquea a ${label}`);
    if (a2?.perAgent?.[agent] === "fail" && a2.blockKind?.[agent] === "origen") {
      capReasons.push(`A2: el servidor rechaza a ${label}`);
    }
  }
  const cap = capReasons.length ? SCORE_CAP : null;
  const normalized = evaluated > 0 ? (100 * earned) / evaluated : null;
  const enoughCoverage = possible > 0 && evaluated / possible >= MIN_COVERAGE;
  const final = normalized === null || !enoughCoverage ? null : Math.min(Math.round(normalized), cap ?? 100);

  return {
    earned: round2(earned),
    evaluated: round2(evaluated),
    possible: round2(possible),
    coverage: possible > 0 ? round2(evaluated / possible) : 0,
    normalized: normalized === null ? null : round2(normalized),
    cap,
    capReasons,
    final,
    band: final === null ? null : bandFor(final),
  };
}

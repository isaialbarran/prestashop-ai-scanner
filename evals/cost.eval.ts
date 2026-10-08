import { expect, it } from "vitest";
import { costLatency } from "../src/evals/metrics";
import { listReports } from "../src/evals/sources";
import { missing } from "./lib";
import { record } from "./record";

const NAME = "Coste y latencia";
const MAX_EUR = 1;
const MAX_SECONDS = 180;

it(NAME, () => {
  const reports = listReports().map((r) => r.report);
  const c = costLatency(reports);
  if (!c.reports) {
    record({ order: 6, eval: NAME, dataset: "—", metric: "€ y s por informe (p50 · p95)", value: "—", threshold: "p95 < 1 € y < 3 min", status: "sin datos" });
    missing("data/private/reports/");
  }
  const eur = (x: number | null) => (x === null ? "—" : `${x.toFixed(2).replace(".", ",")} €`);
  const sec = (x: number | null) => (x === null ? "—" : `${Math.round(x)} s`);
  const ok = (c.costP95 ?? Infinity) < MAX_EUR && (c.latencyP95 ?? Infinity) < MAX_SECONDS;
  record({
    order: 6,
    eval: NAME,
    dataset: `${c.reports} informes (${c.coldReports} en frío)`,
    metric: "€ y s por informe (p50 · p95)",
    value: `${eur(c.costP50)} · ${eur(c.costP95)}; ${sec(c.latencyP50)} · ${sec(c.latencyP95)}`,
    threshold: "p95 < 1 € y < 3 min",
    status: ok ? "ok" : "falla",
  });
  expect(c.costP95).toBeLessThan(MAX_EUR);
  expect(c.coldReports, "hace falta al menos un informe en frío para medir la latencia").toBeGreaterThan(0);
  expect(c.latencyP95).toBeLessThan(MAX_SECONDS);
});

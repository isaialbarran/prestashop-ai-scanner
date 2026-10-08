import { expect, it } from "vitest";
import { runAllChecks } from "../src/checks/index";
import type { CheckStatus } from "../src/schema";
import { ChecksLabelSchema, datasetPath, readJsonl } from "../src/evals/datasets";
import { countDiscrepancies } from "../src/evals/metrics";
import { loadSnapshot } from "../src/evals/sources";
import { missing } from "./lib";
import { record } from "./record";

const NAME = "Checks deterministas";

it(NAME, () => {
  const labels = readJsonl(datasetPath("checks"), ChecksLabelSchema);
  if (!labels?.length) {
    record({ order: 1, eval: NAME, dataset: "—", metric: "Discrepancias A2 · C2 · C3", value: "—", threshold: "< 3 en A2", status: "sin datos" });
    missing(datasetPath("checks"));
  }
  // Los checks se recalculan sin red sobre las respuestas guardadas: mide el código actual.
  const cache = new Map<string, ReturnType<typeof runAllChecks> | null>();
  const rows: { check: string; current: CheckStatus; correct: CheckStatus }[] = [];
  const noSnapshot = new Set<string>();
  for (const l of labels) {
    if (!cache.has(l.domain)) {
      const snapshot = loadSnapshot(l.domain);
      cache.set(l.domain, snapshot ? runAllChecks(snapshot) : null);
    }
    const checks = cache.get(l.domain);
    if (!checks) {
      noSnapshot.add(l.domain);
      continue;
    }
    rows.push({ check: l.check, current: checks.find((c) => c.id === l.check)!.status, correct: l.correctStatus! });
  }
  const d = countDiscrepancies(rows);
  const n = (c: string) => d[c]?.discrepancies ?? 0;
  const a2 = n("A2");
  record({
    order: 1,
    eval: NAME,
    dataset: `${new Set(labels.map((l) => l.domain)).size} tiendas`,
    metric: "Discrepancias A2 · C2 · C3",
    value: `${a2} · ${n("C2")} · ${n("C3")}`,
    threshold: "< 3 en A2",
    status: a2 < 3 ? "ok" : "falla",
  });
  expect([...noSnapshot], "tiendas etiquetadas sin snapshot").toEqual([]);
  expect(a2).toBeLessThan(3);
});

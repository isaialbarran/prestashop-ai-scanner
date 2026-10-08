import { expect, it } from "vitest";
import { REPORTS_DIR } from "../src/evals/datasets";
import { stability } from "../src/evals/metrics";
import { listReports } from "../src/evals/sources";
import { missing } from "./lib";
import { pct, record } from "./record";

const NAME = "Estabilidad";

it(NAME, () => {
  const reports = listReports(REPORTS_DIR, "stability").map((r) => r.report);
  const s = stability(reports);
  if (!s.perDomain.length) {
    record({ order: 5, eval: NAME, dataset: "—", metric: "Variación de citedIn", value: "—", threshold: "Solo medir", status: "sin datos" });
    missing(`${REPORTS_DIR}/stability/ (pnpm batch --mode report --tag stability)`);
  }
  const runs = Math.round(s.perDomain.reduce((a, d) => a + d.runs, 0) / s.perDomain.length);
  record({
    order: 5,
    eval: NAME,
    dataset: `${s.perDomain.length} tiendas × ${runs}`,
    metric: "Variación de citedIn",
    value: `rango medio ${s.meanRange.toFixed(1)} · σ media ${s.meanStd.toFixed(2)} · pares estables ${pct(s.pairAgreement)}`,
    threshold: "Solo medir",
    status: "medido",
  });
  console.table(s.perDomain.map((d) => ({ tienda: d.domain, citedIn: d.citedIn.join(" / "), rango: d.range, σ: d.std.toFixed(2) })));
  expect(s.perDomain.length).toBeGreaterThan(0);
});

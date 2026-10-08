import { expect, it } from "vitest";
import { datasetPath, FidelityLabelSchema, readJsonl } from "../src/evals/datasets";
import { fidelityShare, rawEvidenceCoverage } from "../src/evals/metrics";
import { listReports } from "../src/evals/sources";
import { missing } from "./lib";
import { pct, record } from "./record";

const NAME = "Fidelidad del informe";

it(NAME, () => {
  const labels = readJsonl(datasetPath("fidelity"), FidelityLabelSchema);
  if (!labels?.length) {
    record({ order: 4, eval: NAME, dataset: "—", metric: "% frases respaldadas", value: "—", threshold: "100 %", status: "sin datos" });
    missing(datasetPath("fidelity"));
  }
  const share = fidelityShare(labels);
  const files = new Set(labels.map((l) => l.report));
  const raw = rawEvidenceCoverage(listReports().filter((r) => files.has(r.file)).map((r) => r.report.report));
  record({
    order: 4,
    eval: NAME,
    dataset: `${files.size} informes`,
    metric: "% frases respaldadas (juicio humano)",
    value: `${pct(share.share)} (${share.supported}/${share.total}); borrador con referencia válida ${pct(raw.share)}`,
    threshold: "100 %",
    status: share.share === 1 ? "ok" : "falla",
  });
  expect(share.share).toBe(1);
});

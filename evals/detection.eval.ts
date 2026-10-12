import { expect, it } from "vitest";
import { datasetPath, DetectionLabelSchema, readJsonl } from "../src/evals/datasets";
import { precisionRecall } from "../src/evals/metrics";
import { listReports, loadSnapshot } from "../src/evals/sources";
import { domainOf } from "../src/llm/openai";
import { storeNames } from "../src/llm/queries";
import { detectMention, storeCitations } from "../src/llm/visibility";
import { evalLlm, missing } from "./lib";
import { record } from "./record";

const NAME = "Detección de citas";

it(NAME, async () => {
  const labels = readJsonl(datasetPath("detection"), DetectionLabelSchema);
  if (!labels?.length) {
    record({ order: 3, eval: NAME, dataset: "—", metric: "Precisión · recall", value: "—", threshold: "≥ 0,9 ambas", status: "sin datos" });
    missing(datasetPath("detection"));
  }
  const reports = new Map(listReports().map((r) => [r.file, r.report]));
  const { llm } = evalLlm();
  // Se repite la detección actual (dominio y, si no, LLM) sobre el texto guardado de cada respuesta.
  const pairs = await Promise.all(
    labels.map(async (l) => {
      const report = reports.get(l.report);
      const answer = report?.visibility.answers.find((a) => a.queryId === l.queryId && a.provider === l.provider);
      if (!report || !answer?.text) throw new Error(`Sin respuesta guardada para ${l.id}`);
      const snapshot = loadSnapshot(l.domain);
      const store = {
        domains: [...new Set([domainOf(`https://${report.domain}`), ...(report.scan.origin ? [domainOf(report.scan.origin)] : [])])],
        names: snapshot ? storeNames(snapshot) : [report.domain],
      };
      const citations = (answer.citations ?? []).map((c) => ({ ...c, title: null }));
      const byDomain = storeCitations(citations, store.domains).length > 0;
      const pred = byDomain || (await detectMention(answer.text, store, llm)).mentioned;
      return { label: l.label, pred };
    }),
  );
  const pr = precisionRecall(pairs);
  const fmt = (x: number) => x.toFixed(2).replace(".", ",");
  record({
    order: 3,
    eval: NAME,
    dataset: `${labels.length} respuestas`,
    metric: "Precisión · recall",
    value: `${fmt(pr.precision)} · ${fmt(pr.recall)} (VP ${pr.tp}, FP ${pr.fp}, FN ${pr.fn})`,
    threshold: "≥ 0,9 ambas",
    status: pr.precision >= 0.9 && pr.recall >= 0.9 ? "ok" : "falla",
  });
  expect(pr.precision).toBeGreaterThanOrEqual(0.9);
  expect(pr.recall).toBeGreaterThanOrEqual(0.9);
});

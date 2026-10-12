import { expect, it } from "vitest";
import { datasetPath, ExtractionLabelSchema, readJsonl } from "../src/evals/datasets";
import { extractionAccuracy, FIELDS } from "../src/evals/metrics";
import { loadSnapshot } from "../src/evals/sources";
import { extractProduct } from "../src/llm/extract";
import { evalLlm, missing } from "./lib";
import { pct, record } from "./record";

const NAME = "Extracción";
const LABEL: Record<(typeof FIELDS)[number], string> = { name: "nombre", price: "precio", currency: "moneda", availability: "disponib.", gtin: "gtin", brand: "marca" };

it(NAME, async () => {
  const labels = readJsonl(datasetPath("extraction"), ExtractionLabelSchema);
  if (!labels?.length) {
    record({ order: 2, eval: NAME, dataset: "—", metric: "Acierto exacto por campo", value: "—", threshold: "≥ 95 % en precio", status: "sin datos" });
    missing(datasetPath("extraction"));
  }
  const { llm, ledger } = evalLlm();
  const pairs = await Promise.all(
    labels.map(async (l) => {
      const res = loadSnapshot(l.domain)?.products[l.productIndex]?.fetches.browser?.[0];
      if (!res?.body) throw new Error(`Sin HTML guardado para ${l.id}`);
      const { data } = await extractProduct(res, llm);
      const truth = { name: l.name, price: l.price, currency: l.currency, availability: l.availability, gtin: l.gtin, brand: l.brand };
      return { truth, pred: data };
    }),
  );
  const acc = extractionAccuracy(pairs);
  record({
    order: 2,
    eval: NAME,
    dataset: `${labels.length} fichas`,
    metric: "Acierto exacto por campo",
    value: FIELDS.map((f) => `${LABEL[f]} ${pct(acc[f].accuracy)}`).join(" · "),
    threshold: "≥ 95 % en precio",
    status: acc.price.accuracy >= 0.95 ? "ok" : "falla",
  });
  console.log(`Extracción: ${ledger.spentEur().toFixed(3)} € pagados (${ledger.calls.filter((c) => c.fromCache).length}/${ledger.calls.length} de caché)`);
  expect(acc.price.accuracy).toBeGreaterThanOrEqual(0.95);
});

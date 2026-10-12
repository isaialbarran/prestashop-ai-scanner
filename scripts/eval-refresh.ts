// Rehace la extracción de los snapshots guardados con el prompt actual, sin red: el eval de checks calcula C2 con ella.
// Uso: pnpm eval:refresh <dominios.csv>   (caché del LLM: sin cambios en el prompt no cuesta nada)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDomains } from "../src/batch/csv";
import { SNAPSHOTS_DIR } from "../src/evals/datasets";
import { loadSnapshot } from "../src/evals/sources";
import { runExtraction } from "../src/pipeline";
import { evalLlm } from "../evals/lib";

const [csv] = process.argv.slice(2);
if (!csv) {
  console.error("Uso: pnpm eval:refresh <dominios.csv>");
  process.exit(2);
}
const { llm, ledger } = evalLlm();
let changed = 0;
for (const domain of parseDomains(await readFile(csv, "utf8"))) {
  const snapshot = loadSnapshot(domain);
  if (!snapshot) {
    console.log(`  ${domain}: sin snapshot`);
    continue;
  }
  const before = JSON.stringify(snapshot.extracted ?? null);
  await runExtraction(snapshot, llm);
  if (JSON.stringify(snapshot.extracted) !== before) changed++;
  await writeFile(path.join(SNAPSHOTS_DIR, `${domain}.json`), JSON.stringify(snapshot));
}
console.log(`✓ ${changed} snapshots con extracción distinta · ${ledger.spentEur().toFixed(3)} €`);

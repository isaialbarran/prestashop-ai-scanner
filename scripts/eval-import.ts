// Importa una plantilla rellenada (CSV) a data/private/evals/<tipo>.jsonl y hace copia en Supabase (eval_labels).
// Uso: pnpm eval:import checks|extraction|fidelity <archivo.csv> [--no-db]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { z } from "zod";
import { createServerClient } from "../src/db/supabase";
import { loadEnv } from "../src/env";
import { parseCsv } from "../src/evals/csv";
import { datasetPath, LABEL_SCHEMAS, readJsonl, writeJsonl } from "../src/evals/datasets";
import { importRows, mergeById } from "../src/evals/import";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { "no-db": { type: "boolean", default: false } } });
const [kind, file] = positionals as ["checks" | "extraction" | "fidelity", string];
if (!["checks", "extraction", "fidelity"].includes(kind) || !file) {
  console.error("Uso: pnpm eval:import checks|extraction|fidelity <archivo.csv>  (la detección se etiqueta con pnpm label detection)");
  process.exit(2);
}

const { labels, skipped, errors } = importRows(kind, parseCsv(await readFile(file, "utf8")));
if (errors.length) {
  console.error(`✗ ${errors.length} filas con errores; no se ha importado nada:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

const target = datasetPath(kind);
const existing = readJsonl(target, LABEL_SCHEMAS[kind] as unknown as z.ZodType<{ id: string }>) ?? [];
const merged = mergeById(existing, labels as { id: string }[]);
writeJsonl(target, merged);
console.log(`✓ ${labels.length} etiquetas importadas (${skipped} filas sin etiquetar) · ${target} tiene ${merged.length}`);

if (!values["no-db"]) {
  try {
    loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
    const { error } = await createServerClient()
      .from("eval_labels")
      .upsert(merged.map((l) => ({ kind, item_id: l.id, label: l, labeled_at: new Date().toISOString() })));
    if (error) throw new Error(error.message);
    console.log("✓ Copia en Supabase (eval_labels)");
  } catch (err) {
    console.warn(`Supabase: ${err instanceof Error ? err.message : String(err)}`);
  }
}

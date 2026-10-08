// Etiquetado a ciegas de la detección de citas: ¿la respuesta cita o menciona la tienda?
// Uso: pnpm label detection   (se puede cortar con q y retomar: guarda cada respuesta al momento)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createServerClient } from "../src/db/supabase";
import { loadEnv } from "../src/env";
import { DATASETS_DIR, datasetPath, DetectionLabelSchema, readJsonl } from "../src/evals/datasets";

const todoFile = path.join(DATASETS_DIR, "detection.todo.jsonl");
if (!existsSync(todoFile)) {
  console.error(`Falta ${todoFile}: lanza antes pnpm eval:prepare detection`);
  process.exit(1);
}
interface Todo {
  id: string;
  report: string;
  domain: string;
  storeNames: string[];
  queryId: string;
  provider: "openai" | "perplexity";
  query: string;
  text: string;
  citations: string[];
}
const todo = readFileSync(todoFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Todo);
const target = datasetPath("detection");
const done = new Set((readJsonl(target, DetectionLabelSchema) ?? []).map((l) => l.id));
const pending = todo.filter((t) => !done.has(t.id));

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`${done.size} ya etiquetadas · ${pending.length} pendientes. Criterios: evals/GUIDELINES.md\n`);
let labeled = 0;
for (const [i, t] of pending.entries()) {
  console.clear();
  console.log(`[${done.size + i + 1}/${todo.length}] Tienda: ${t.domain} (${t.storeNames.join(", ")})`);
  console.log(`Consulta (${t.provider === "openai" ? "ChatGPT" : "Perplexity"}): ${t.query}\n`);
  console.log(t.text.trim());
  console.log(`\nURLs citadas:\n${t.citations.map((u) => `  - ${u}`).join("\n") || "  (ninguna)"}\n`);
  let answer = "";
  while (!["s", "n", "o", "q"].includes(answer)) {
    answer = (await rl.question("¿Cita o menciona la tienda? [s]í / [n]o / [o]mitir / [q] salir: ")).trim().toLowerCase();
  }
  if (answer === "q") break;
  if (answer === "o") continue;
  const note = (await rl.question("Nota (opcional, Enter para seguir): ")).trim();
  const label = DetectionLabelSchema.parse({ id: t.id, report: t.report, domain: t.domain, queryId: t.queryId, provider: t.provider, label: answer === "s", note });
  appendFileSync(target, `${JSON.stringify(label)}\n`);
  labeled++;
}
rl.close();

const all = readJsonl(target, DetectionLabelSchema) ?? [];
console.log(`\n✓ ${labeled} etiquetas nuevas · ${all.length}/${todo.length} en ${target}`);
try {
  loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  const { error } = await createServerClient()
    .from("eval_labels")
    .upsert(all.map((l) => ({ kind: "detection", item_id: l.id, label: l, labeled_at: new Date().toISOString() })));
  if (error) throw new Error(error.message);
  console.log("✓ Copia en Supabase (eval_labels)");
} catch (err) {
  console.warn(`Supabase: ${err instanceof Error ? err.message : String(err)}`);
}

// Asistente de etiquetado en la terminal: un caso cada vez, una pregunta corta, guarda al momento.
// Uso: pnpm label checks | extraction | detection | fidelity   (q para salir; al volver sigue donde lo dejaste)
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { z } from "zod";
import { createServerClient } from "../src/db/supabase";
import { loadEnv } from "../src/env";
import { parseCsv } from "../src/evals/csv";
import { DATASETS_DIR, datasetPath, LABEL_SCHEMAS, readJsonl, writeJsonl, type Kind } from "../src/evals/datasets";
import { mergeById } from "../src/evals/import";
import { availabilityFromKey, AVAILABILITY_MENU, CHECK_GUIDE, evidenceLines, headingOf, progress, STATUS_KEYS, textAnswer } from "../src/evals/label";
import { parsePrice } from "../src/parse/product";

const kind = process.argv[2] as Kind;
if (!["checks", "extraction", "detection", "fidelity"].includes(kind)) {
  console.error("Uso: pnpm label checks | extraction | detection | fidelity");
  process.exit(2);
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// Las respuestas se leen de una cola de líneas: funciona igual tecleando que con la entrada redirigida.
// Si se acaba la entrada (Ctrl+D), se responde «q» y se sale guardando lo hecho.
const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q: string) => {
  process.stdout.write(q);
  const next = await lines.next();
  if (next.done) {
    process.stdout.write("\n");
    return "q";
  }
  if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`);
  return String(next.value).trim();
};
const askKey = async (q: string, keys: string[]) => {
  for (;;) {
    const a = (await ask(q)).toLowerCase();
    if (keys.includes(a)) return a;
  }
};
const open = (target: string) => {
  if (process.env.LABEL_NO_OPEN) return;
  execFile(process.platform === "darwin" ? "open" : "xdg-open", [target], () => undefined);
};

type Row = Record<string, string>;
const items = loadItems();
const schema = LABEL_SCHEMAS[kind] as unknown as z.ZodType<{ id: string }>;
const target = datasetPath(kind);
let labels = readJsonl(target, schema) ?? [];
const done = () => new Set(labels.map((l) => l.id));

function save(raw: unknown) {
  const label = schema.parse(raw);
  labels = mergeById(labels, [label]);
  writeJsonl(target, labels);
}

function loadItems(): Row[] {
  const file = path.join(DATASETS_DIR, kind === "detection" ? "detection.todo.jsonl" : `${kind}.todo.csv`);
  if (!existsSync(file)) {
    console.error(`Falta ${file}: genera antes la plantilla con pnpm eval:prepare ${kind}`);
    process.exit(1);
  }
  const text = readFileSync(file, "utf8");
  return kind === "detection" ? text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row) : parseCsv(text);
}

const pending = items.filter((i) => !done().has(i.id));
console.log(`${done().size} de ${items.length} ya etiquetados · ${pending.length} pendientes. Criterios completos: evals/GUIDELINES.md`);
await ask(dim("Enter para empezar… "));

let labeled = 0;
for (const item of pending) {
  console.clear();
  console.log(`${dim(progress(done().size, items.length))}\n`);
  const result =
    kind === "checks" ? await labelCheck(item) : kind === "extraction" ? await labelExtraction(item) : kind === "detection" ? await labelDetection(item) : await labelFidelity(item);
  if (result === "quit") break;
  if (result === "saved") labeled++;
}
rl.close();
console.log(`\n${green("✓")} ${labeled} etiquetas nuevas · ${done().size}/${items.length} en ${target}`);
await backup();

// ── checks ──────────────────────────────────────────────────────────────────

async function labelCheck(row: Row): Promise<"saved" | "skip" | "quit"> {
  const guide = CHECK_GUIDE[row.check]!;
  const urls = row.urls.split(/\s+/).filter(Boolean);
  console.log(`${bold(row.dominio)} · ${cyan(row.check)}: ${guide.title}\n`);
  console.log(`El escáner dice: ${bold(row.estado_escaner.toUpperCase())} (${row.puntos} puntos)\n`);
  console.log("Lo que vio:");
  for (const line of evidenceLines(row.evidencia)) console.log(`  · ${line}`);
  console.log(`\nFichas:\n${urls.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}\n`);
  console.log(dim(`Cómo comprobarlo: ${guide.how}\n`));
  for (;;) {
    const a = await askKey(`¿Estás de acuerdo con ${bold(row.estado_escaner.toUpperCase())}?  [s]í  [n]o  [a]brir las fichas  [o]mitir  [q] salir: `, ["s", "n", "a", "o", "q"]);
    if (a === "a") {
      urls.forEach(open);
      continue;
    }
    if (a === "q") return "quit";
    if (a === "o") return "skip";
    const base = { id: row.id, domain: row.dominio, check: row.check, scannerStatus: row.estado_escaner };
    if (a === "s") {
      save({ ...base, agree: true, correctStatus: null, note: null });
      return "saved";
    }
    const k = await askKey("¿Cuál sería el estado correcto?  [p]ass  [f]ail  [h]int (parcial)  [i]nconcluso: ", Object.keys(STATUS_KEYS));
    const note = await ask("¿Por qué? (una frase; Enter para saltar): ");
    save({ ...base, agree: false, correctStatus: STATUS_KEYS[k], note: note || null });
    return "saved";
  }
}

// ── extracción ──────────────────────────────────────────────────────────────

async function labelExtraction(row: Row): Promise<"saved" | "skip" | "quit"> {
  const view = path.resolve(DATASETS_DIR, row.vista_bot);
  const heading = existsSync(view) ? headingOf(readFileSync(view, "utf8")) : null;
  open(view);
  console.log(`${bold(row.dominio)} · ficha ${row.indice}\n${dim(row.url)}\n`);
  console.log("Se ha abierto en el navegador la ficha «como bot» (sin JavaScript). Apunta lo que se ve ahí, no en la web normal.");
  console.log(dim("En cada campo: Enter acepta lo que hay entre corchetes, «-» = no aparece en la página.\n"));
  const start = await askKey("Enter para empezar  [v] volver a abrirla  [o]mitir  [q] salir: ", ["", "v", "o", "q"]);
  if (start === "q") return "quit";
  if (start === "o") return "skip";
  if (start === "v") open(view);

  for (;;) {
    const name = textAnswer(await ask(`Nombre del producto [${heading ? `Enter = «${heading}»` : "Enter = no aparece"}]: `), heading);
    let price: number | null = null;
    for (;;) {
      const p = await ask("Precio final con IVA, p. ej. 4,55 [Enter = no aparece]: ");
      if (p === "" || p === "-") break;
      price = parsePrice(p);
      if (price !== null) break;
      console.log("  No entiendo ese precio; escribe solo el número, p. ej. 12,90");
    }
    const currency = textAnswer((await ask("Moneda [Enter = EUR]: ")).toUpperCase(), "EUR");
    console.log("Disponibilidad según el texto de la página:");
    for (const m of AVAILABILITY_MENU) console.log(`  ${m.key}. ${m.value.padEnd(20)} ${dim(m.text)}`);
    let availability: ReturnType<typeof availabilityFromKey>;
    do availability = availabilityFromKey(await ask("Número [Enter = no hay texto de disponibilidad]: "));
    while (availability === undefined);
    const gtin = textAnswer(await ask("EAN/GTIN escrito en la página [Enter = no aparece]: "), null);
    const brand = textAnswer(await ask("Marca o fabricante escrito en la página [Enter = no aparece]: "), null);

    console.log(`\n  nombre ${name ?? "—"} · precio ${price ?? "—"} · moneda ${currency ?? "—"} · disponibilidad ${availability ?? "—"} · gtin ${gtin ?? "—"} · marca ${brand ?? "—"}`);
    const ok = await askKey("¿Guardar?  [s]í  [r]epetir esta ficha  [o]mitir  [q] salir: ", ["s", "r", "o", "q"]);
    if (ok === "q") return "quit";
    if (ok === "o") return "skip";
    if (ok === "r") continue;
    save({ id: row.id, domain: row.dominio, productIndex: row.indice, url: row.url, name, price, currency, availability, gtin, brand, note: null });
    return "saved";
  }
}

// ── detección ───────────────────────────────────────────────────────────────

async function labelDetection(item: Row): Promise<"saved" | "skip" | "quit"> {
  const t = item as unknown as { id: string; report: string; domain: string; storeNames: string[]; queryId: string; provider: string; query: string; text: string; citations: string[] };
  console.log(`Tienda: ${bold(t.domain)} ${dim(`(${t.storeNames.join(", ")})`)}`);
  console.log(`${t.provider === "openai" ? "ChatGPT" : "Perplexity"} respondió a: ${cyan(t.query)}\n`);
  console.log(t.text.trim());
  console.log(`\nURLs citadas:\n${t.citations.map((u) => `  - ${u}`).join("\n") || "  (ninguna)"}\n`);
  const a = await askKey(`¿La respuesta cita o nombra ${bold(t.domain)}?  [s]í  [n]o  [o]mitir  [q] salir: `, ["s", "n", "o", "q"]);
  if (a === "q") return "quit";
  if (a === "o") return "skip";
  save({ id: t.id, report: t.report, domain: t.domain, queryId: t.queryId, provider: t.provider, label: a === "s", note: null });
  return "saved";
}

// ── fidelidad ───────────────────────────────────────────────────────────────

async function labelFidelity(row: Row): Promise<"saved" | "skip" | "quit"> {
  console.log(`${bold(row.dominio)} · ${row.parte}\n`);
  console.log(`Frase del informe:\n  ${bold(row.frase)}\n`);
  console.log("Evidencia en la que dice basarse:");
  for (const line of evidenceLines(row.evidencia)) console.log(`  · ${line}`);
  console.log(dim("\nRespaldada = todo lo que afirma (cifras, número de fichas, qué consulta, qué competidores) está en la evidencia. Un arreglo genérico que se deduce del fallo citado cuenta como respaldado.\n"));
  const a = await askKey("¿La evidencia respalda la frase?  [s]í  [n]o  [o]mitir  [q] salir: ", ["s", "n", "o", "q"]);
  if (a === "q") return "quit";
  if (a === "o") return "skip";
  const note = a === "n" ? await ask("¿Qué no cuadra? (una frase; Enter para saltar): ") : "";
  save({ id: row.id, report: row.informe, domain: row.dominio, part: row.parte, sentence: row.frase, refs: row.referencias, supported: a === "s", note: note || null });
  return "saved";
}

// ── copia en Supabase ───────────────────────────────────────────────────────

async function backup() {
  try {
    loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
    const { error } = await createServerClient()
      .from("eval_labels")
      .upsert(labels.map((l) => ({ kind, item_id: l.id, label: l, labeled_at: new Date().toISOString() })));
    if (error) throw new Error(error.message);
    console.log(`${green("✓")} Copia en Supabase (eval_labels)`);
  } catch (err) {
    console.warn(`Supabase: ${err instanceof Error ? err.message : String(err)}`);
  }
}

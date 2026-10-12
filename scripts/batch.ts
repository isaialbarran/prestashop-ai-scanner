// Lote sobre un CSV de dominios.
// Uso: pnpm batch <dominios.csv> [--mode scan|extract|report] [--repeat N] [--start-index N] [--fresh-search]
//                 [--tag nombre] [--no-cache] [--no-db] [--limit N] [--keep-html] [--out dir] [--snapshots dir]
//   scan     escaneo determinista (fase 1)
//   extract  escaneo + extracción como bot: C2 evaluado, para el eval de checks (< 1 céntimo por tienda)
//   report   informe completo; --repeat y --fresh-search para el eval de estabilidad
// --no-cache no lee la caché pero sí la escribe: la ejecución es en frío y deja el resultado para las siguientes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { LLM_LIMITS } from "../config/models";
import { POLITENESS } from "../config/scanner";
import { parseDomains, percentile } from "../src/batch/csv";
import { saveLlmCalls, saveReport } from "../src/db/reports";
import { saveScan } from "../src/db/scans";
import { createServerClient } from "../src/db/supabase";
import { loadEnv } from "../src/env";
import { createDiskCache, type HttpCache } from "../src/fetch/cache";
import { createFetcher } from "../src/fetch/client";
import { pageSpeedRunner } from "../src/fetch/pagespeed-runner";
import { BudgetExceededError, CostLedger } from "../src/llm/cost";
import { createLlmDiskCache, createLlmPool, type LlmCache } from "../src/llm/live";
import type { Purpose } from "../src/llm/types";
import { runExtraction, runReport } from "../src/pipeline";
import { collectSnapshot, evaluateSnapshot, scanDomain } from "../src/scan";
import type { ReportResult, ScanResult } from "../src/schema";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "scan" },
    repeat: { type: "string", default: "1" },
    "start-index": { type: "string", default: "1" },
    "fresh-search": { type: "boolean", default: false },
    tag: { type: "string" },
    "no-cache": { type: "boolean", default: false },
    "no-db": { type: "boolean", default: false },
    "keep-html": { type: "boolean", default: false },
    limit: { type: "string" },
    out: { type: "string" },
    snapshots: { type: "string", default: "data/private/snapshots" },
  },
});

const csvPath = positionals[0];
const mode = values.mode as "scan" | "extract" | "report";
if (!csvPath || !["scan", "extract", "report"].includes(mode)) {
  console.error("Uso: pnpm batch <dominios.csv> [--mode scan|extract|report] [--repeat N] [--fresh-search] [--tag nombre] [--no-cache] [--no-db]");
  process.exit(2);
}
if (mode !== "scan") loadEnv(["OPENAI_API_KEY", ...(mode === "report" ? (["PERPLEXITY_API_KEY"] as const) : [])]);

const domains = parseDomains(await readFile(csvPath, "utf8")).slice(0, values.limit ? Number(values.limit) : undefined);
const outDir = values.out ?? (mode === "report" ? "data/private/reports" : "data/private/scans");
const reportDir = values.tag ? path.join(outDir, values.tag) : outDir;
await mkdir(reportDir, { recursive: true });
await mkdir(values.snapshots!, { recursive: true });

const refresh = values["no-cache"];
const httpCache = writeOnlyIf(refresh, createDiskCache());
const llmCache: LlmCache = writeOnlyIf(refresh, createLlmDiskCache());
const ALL: Purpose[] = ["queries", "visibility", "detection", "extraction", "report"];
const freshPurposes: Purpose[] = refresh ? ALL : values["fresh-search"] ? ["visibility"] : [];
const pool = createLlmPool({ cache: llmCache, freshPurposes });
const pagespeed = pageSpeedRunner(!refresh);
const db = values["no-db"] ? null : tryDb();
const { MAX_BATCH_EUR } = mode === "scan" ? { MAX_BATCH_EUR: Infinity } : loadEnv(["MAX_BATCH_EUR"]);
let batchSpentEur = 0;

const repeat = Math.max(1, Number(values.repeat));
const startIndex = Number(values["start-index"]);
console.log(
  `${domains.length} dominios · modo ${mode}${mode === "report" ? ` · ${repeat} repetición(es) desde la ${startIndex}${values["fresh-search"] ? " · búsquedas nuevas" : ""}` : ""} · caché ${refresh ? "solo escritura" : "sí"} · Supabase ${db ? "sí" : "no"}${mode !== "scan" ? ` · tope del lote ${MAX_BATCH_EUR} €` : ""}\n`,
);

type Row = { domain: string; run: number | null; scan?: ScanResult; report?: ReportResult; error?: string };
const limit = pLimit(mode === "report" ? 2 : POLITENESS.parallelDomains);
const rows: Row[] = (
  await Promise.all(
    domains.map((domain) =>
      limit(async (): Promise<Row[]> => {
        if (mode === "scan") return [await scanOne(domain)];
        if (mode === "extract") return [await extractOne(domain)];
        const out: Row[] = [];
        for (let i = startIndex; i < startIndex + repeat; i++) out.push(await reportOne(domain, values.tag || values["fresh-search"] || repeat > 1 ? i : null));
        return out;
      }),
    ),
  )
).flat();

printSummary(rows);
process.exit(rows.some((r) => r.error) ? 1 : 0);

async function scanOne(domain: string): Promise<Row> {
  try {
    const { result, snapshot } = await scanDomain(domain, { fetcher: createFetcher({ cache: httpCache }), pagespeed: pagespeed ?? undefined });
    await writeFile(path.join(outDir, `${result.domain}.json`), JSON.stringify(result, null, 2));
    if (values["keep-html"]) await writeFile(path.join(values.snapshots!, `${result.domain}.json`), JSON.stringify(snapshot));
    if (db) await saveScan(db, result).catch((err: Error) => result.errors.push(err.message));
    console.log(`✓ ${domain} · ${result.score.final ?? "—"} · ${Math.round(result.durationMs / 1000)} s`);
    return { domain, run: null, scan: result };
  } catch (err) {
    return fail(domain, null, err);
  }
}

async function extractOne(domain: string): Promise<Row> {
  if (batchSpentEur >= MAX_BATCH_EUR) return fail(domain, null, new Error(`presupuesto del lote agotado (${batchSpentEur.toFixed(2)} €)`));
  const ledger = new CostLedger(LLM_LIMITS.maxEurPerReport);
  try {
    const started = performance.now();
    const fetcher = createFetcher({ cache: httpCache });
    const { snapshot, errors } = await collectSnapshot(domain, { fetcher, pagespeed: pagespeed ?? undefined });
    await runExtraction(snapshot, pool.forLedger(ledger));
    const result = evaluateSnapshot(snapshot, { fetcher, started, errors });
    await writeFile(path.join(outDir, `${result.domain}.json`), JSON.stringify(result, null, 2));
    await writeFile(path.join(values.snapshots!, `${result.domain}.json`), JSON.stringify(snapshot));
    if (db) {
      await saveScan(db, result).catch((err: Error) => result.errors.push(err.message));
      await saveLlmCalls(db, ledger.calls, result.domain, null).catch(() => undefined);
    }
    console.log(`✓ ${domain} · ${result.score.final ?? "—"} · C2 ${result.checks.find((c) => c.id === "C2")?.status} · ${ledger.spentEur().toFixed(3)} €`);
    return { domain, run: null, scan: result };
  } catch (err) {
    return fail(domain, null, err);
  } finally {
    batchSpentEur += ledger.spentEur();
  }
}

async function reportOne(domain: string, run: number | null): Promise<Row> {
  if (batchSpentEur >= MAX_BATCH_EUR) return fail(domain, run, new Error(`presupuesto del lote agotado (${batchSpentEur.toFixed(2)} €)`));
  const ledger = new CostLedger(LLM_LIMITS.maxEurPerReport);
  try {
    const { result, snapshot } = await runReport(domain, {
      fetcher: createFetcher({ cache: httpCache }),
      pagespeed: pagespeed ?? undefined,
      llm: pool.forLedger(ledger),
      ledger,
      run: { tag: values.tag ?? null, index: run },
    });
    const name = run === null ? `${result.domain}.json` : `${result.domain}-${run}.json`;
    await writeFile(path.join(reportDir, name), JSON.stringify(result, null, 2));
    await writeFile(path.join(values.snapshots!, `${result.domain}.json`), JSON.stringify(snapshot));
    if (db) await saveReport(db, result, ledger.calls).catch((err: Error) => console.warn(`  ${domain}: ${err.message}`));
    const v = result.visibility;
    console.log(`✓ ${domain}${run !== null ? ` #${run}` : ""} · nota ${result.scan.score.final ?? "—"} · citada ${v.citedIn}/${v.total} · ${result.cost.totalEur.toFixed(2)} € · ${Math.round(result.latencyMs / 1000)} s`);
    return { domain, run, report: result };
  } catch (err) {
    if (db) await saveLlmCalls(db, ledger.calls, domain, null).catch(() => undefined);
    return fail(domain, run, err);
  } finally {
    batchSpentEur += ledger.spentEur();
  }
}

function fail(domain: string, run: number | null, err: unknown): Row {
  const message = err instanceof BudgetExceededError ? `${err.message}: informe detenido` : err instanceof Error ? err.message : String(err);
  console.log(`✗ ${domain}${run !== null ? ` #${run}` : ""} · ${message}`);
  return { domain, run, error: message };
}

function writeOnlyIf<T extends HttpCache | LlmCache>(writeOnly: boolean, cache: T): T {
  return writeOnly ? ({ ...cache, get: async () => null } as T) : cache;
}

function tryDb() {
  try {
    loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
    return createServerClient();
  } catch {
    console.warn("Supabase sin configurar: los resultados solo se guardan en JSON.");
    return null;
  }
}

function printSummary(rows: Row[]) {
  console.log();
  if (mode === "report") {
    const ok = rows.filter((r): r is Row & { report: ReportResult } => !!r.report);
    console.table(
      ok.map(({ report: r, run }) => ({
        dominio: r.domain,
        ejecución: run ?? "",
        nota: r.scan.score.final ?? "—",
        citada: `${r.visibility.citedIn}/${r.visibility.total}`,
        euros: r.cost.totalEur.toFixed(3),
        segundos: Math.round(r.latencyMs / 1000),
        "llamadas (caché)": `${r.cost.llmCalls} (${r.cost.cachedCalls})`,
      })),
    );
    const cost = ok.map((r) => r.report.cost.totalEur);
    const secs = ok.map((r) => r.report.latencyMs / 1000);
    console.log(
      `${ok.length}/${rows.length} informes · coste p50 ${percentile(cost, 50)?.toFixed(3) ?? "—"} € · p95 ${percentile(cost, 95)?.toFixed(3) ?? "—"} € · duración p50 ${percentile(secs, 50)?.toFixed(0) ?? "—"} s · p95 ${percentile(secs, 95)?.toFixed(0) ?? "—"} s · pagado en este lote ${batchSpentEur.toFixed(2)} € · ${reportDir}`,
    );
  } else {
    const ok = rows.filter((r): r is Row & { scan: ScanResult } => !!r.scan);
    console.table(
      ok.map(({ scan: r }) => ({
        dominio: r.domain,
        nota: r.score.final ?? "—",
        tramo: r.score.band ?? "—",
        tope: r.score.cap ? "40" : "",
        cobertura: `${Math.round(r.score.coverage * 100)} %`,
        fichas: r.pages.products.length,
        peticiones: `${r.requests.network}${r.requests.cached ? ` (+${r.requests.cached} caché)` : ""}`,
        segundos: Math.round(r.durationMs / 1000),
        versión: r.platform.version ?? (r.platform.prestashop ? "?" : "no PS"),
        errores: r.errors.length,
      })),
    );
    const durations = ok.map((r) => r.scan.durationMs / 1000);
    console.log(
      `${ok.length}/${rows.length} dominios · duración p50 ${percentile(durations, 50)?.toFixed(1) ?? "—"} s · p95 ${percentile(durations, 95)?.toFixed(1) ?? "—"} s${mode === "extract" ? ` · pagado ${batchSpentEur.toFixed(3)} €` : ""} · ${outDir}`,
    );
  }
  for (const r of rows.filter((r) => r.error)) console.log(`✗ ${r.domain}${r.run !== null ? ` #${r.run}` : ""}: ${r.error}`);
}

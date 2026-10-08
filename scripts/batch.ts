// Escanea un CSV de dominios y devuelve un ScanResult por dominio.
// Uso: pnpm batch <dominios.csv> [--no-cache] [--no-db] [--limit N] [--keep-html] [--out dir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { POLITENESS } from "../config/scanner";
import { parseDomains, percentile } from "../src/batch/csv";
import { saveScan } from "../src/db/scans";
import { createServerClient } from "../src/db/supabase";
import { loadEnv } from "../src/env";
import { createDiskCache } from "../src/fetch/cache";
import { createFetcher } from "../src/fetch/client";
import { pageSpeedRunner } from "../src/fetch/pagespeed-runner";
import { scanDomain } from "../src/scan";
import type { ScanResult } from "../src/schema";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "no-cache": { type: "boolean", default: false },
    "no-db": { type: "boolean", default: false },
    "keep-html": { type: "boolean", default: false },
    limit: { type: "string" },
    out: { type: "string", default: "data/private/scans" },
  },
});

const csvPath = positionals[0];
if (!csvPath) {
  console.error("Uso: pnpm batch <dominios.csv> [--no-cache] [--no-db] [--limit N] [--keep-html] [--out dir]");
  process.exit(2);
}

const domains = parseDomains(await readFile(csvPath, "utf8")).slice(0, values.limit ? Number(values.limit) : undefined);
const outDir = values.out!;
await mkdir(outDir, { recursive: true });
if (values["keep-html"]) await mkdir(path.join(outDir, "snapshots"), { recursive: true });

const cache = values["no-cache"] ? null : createDiskCache();
const pagespeed = pageSpeedRunner(!values["no-cache"]);
const db = values["no-db"] ? null : tryDb();

console.log(
  `${domains.length} dominios · ${POLITENESS.parallelDomains} en paralelo · caché ${cache ? "sí" : "no"} · PageSpeed ${pagespeed ? "sí" : "no"} · Supabase ${db ? "sí" : "no"}\n`,
);

type Row = { domain: string; result?: ScanResult; error?: string };
const limit = pLimit(POLITENESS.parallelDomains);
const rows: Row[] = await Promise.all(
  domains.map((domain) =>
    limit(async (): Promise<Row> => {
      try {
        const { result, snapshot } = await scanDomain(domain, { fetcher: createFetcher({ cache }), pagespeed: pagespeed ?? undefined });
        await writeFile(path.join(outDir, `${result.domain}.json`), JSON.stringify(result, null, 2));
        if (values["keep-html"]) await writeFile(path.join(outDir, "snapshots", `${result.domain}.json`), JSON.stringify(snapshot));
        if (db) await saveScan(db, result).catch((err: Error) => result.errors.push(err.message));
        console.log(`✓ ${domain} · ${result.score.final ?? "—"} · ${Math.round(result.durationMs / 1000)} s`);
        return { domain, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${domain} · ${message}`);
        return { domain, error: message };
      }
    }),
  ),
);

printSummary(rows);
process.exit(rows.some((r) => r.error) ? 1 : 0);

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
  const ok = rows.filter((r): r is Row & { result: ScanResult } => !!r.result);
  const table = ok.map(({ result: r }) => ({
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
  }));
  console.log();
  console.table(table);
  const durations = ok.map((r) => r.result.durationMs / 1000);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  console.log(
    `${ok.length}/${rows.length} dominios escaneados · duración p50 ${p50?.toFixed(1) ?? "—"} s · p95 ${p95?.toFixed(1) ?? "—"} s · resultados en ${outDir}`,
  );
  for (const r of rows.filter((r) => r.error)) console.log(`✗ ${r.domain}: ${r.error}`);
}

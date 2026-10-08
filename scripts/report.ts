// Informe completo de un dominio: escaneo, extracción, consultas, visibilidad y titular con 3 hallazgos.
// Uso: pnpm report <dominio> [--no-cache] [--no-db] [--openai-model <id>] [--out dir]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { LLM_LIMITS, MODELS } from "../config/models";
import { saveLlmCalls, saveReport } from "../src/db/reports";
import { createServerClient } from "../src/db/supabase";
import { loadEnv } from "../src/env";
import { createDiskCache } from "../src/fetch/cache";
import { createFetcher } from "../src/fetch/client";
import { pageSpeedRunner } from "../src/fetch/pagespeed-runner";
import { BudgetExceededError, CostLedger, toEur } from "../src/llm/cost";
import { createLiveLlm, createLlmDiskCache } from "../src/llm/live";
import { runReport } from "../src/pipeline";
import { normalizeDomain } from "../src/scan";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "no-cache": { type: "boolean", default: false },
    "no-db": { type: "boolean", default: false },
    "openai-model": { type: "string" },
    out: { type: "string", default: "data/private/reports" },
  },
});
const input = positionals[0];
if (!input) {
  console.error("Uso: pnpm report <dominio> [--no-cache] [--no-db] [--openai-model <id>] [--out dir]");
  process.exit(2);
}
loadEnv(["OPENAI_API_KEY", "PERPLEXITY_API_KEY"]);

const domain = normalizeDomain(input);
const useCache = !values["no-cache"];
const ledger = new CostLedger(LLM_LIMITS.maxEurPerReport);
const llm = createLiveLlm({ ledger, cache: useCache ? createLlmDiskCache() : null });
const db = values["no-db"] ? null : tryDb();
const openaiModel = values["openai-model"] ?? MODELS.visibilityOpenAI;

console.log(`${domain} · ChatGPT ${openaiModel} · Perplexity ${MODELS.visibilityPerplexity} · caché ${useCache ? "sí" : "no"} · Supabase ${db ? "sí" : "no"}\n`);

try {
  const { result } = await runReport(domain, {
    fetcher: createFetcher({ cache: useCache ? createDiskCache() : null }),
    pagespeed: pageSpeedRunner(useCache) ?? undefined,
    llm,
    ledger,
    visibility: { models: { openai: openaiModel } },
    log: (m) => console.log(`· ${m}`),
  });

  await mkdir(values.out!, { recursive: true });
  const file = path.join(values.out!, `${domain}.json`);
  await writeFile(file, JSON.stringify(result, null, 2));
  if (db) await saveReport(db, result, ledger.calls);

  const v = result.visibility;
  console.log(`\nNota técnica: ${result.scan.score.final ?? "—"} (${result.scan.score.band ?? "sin tramo"})${result.scan.score.cap ? `, topada en ${result.scan.score.cap}` : ""}`);
  console.log(`Visibilidad: citada en ${v.citedIn} de ${v.total} respuestas · ${Object.entries(v.byProvider).map(([p, b]) => `${p} ${b!.cited}/${b!.total}`).join(" · ")}`);
  console.log(`Competidores: ${v.topCompetitors.map((c) => `${c.domain} (${c.answers})`).join(", ") || "—"}`);
  console.log(`\n${result.report.headline ?? "(sin titular con evidencia)"}\n`);
  result.report.findings.forEach((f, i) => console.log(`${i + 1}. ${f}\n`));
  if (result.report.dropped.length) console.log(`(${result.report.dropped.length} frases descartadas por no tener evidencia)\n`);

  console.table(
    Object.fromEntries(
      Object.entries(result.cost.byPurpose).map(([purpose, c]) => [purpose, { llamadas: c.calls, usd: c.costUsd.toFixed(4), eur: toEur(c.costUsd).toFixed(4) }]),
    ),
  );
  console.log(
    `Coste del informe: ${result.cost.totalEur.toFixed(3)} € (${result.cost.totalUsd.toFixed(3)} $) · pagado en esta ejecución: ${ledger.spentEur().toFixed(3)} € · ${result.cost.llmCalls} llamadas (${result.cost.cachedCalls} de caché) · ${Math.round(result.latencyMs / 1000)} s · ${file}`,
  );
  const errors = v.answers.filter((a) => a.error);
  if (errors.length) console.log(`\n${errors.length} consultas fallaron: ${[...new Set(errors.map((e) => e.error))].join(" | ")}`);
} catch (err) {
  if (err instanceof BudgetExceededError) console.error(`✗ ${err.message}: informe detenido`);
  else console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  if (db) await saveLlmCalls(db, ledger.calls, domain, null).catch(() => undefined);
  console.error(`Gastado: ${ledger.spentEur().toFixed(3)} € en ${ledger.calls.length} llamadas`);
  process.exit(1);
}

function tryDb() {
  try {
    loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
    return createServerClient();
  } catch {
    console.warn("Supabase sin configurar: el informe solo se guarda en JSON.");
    return null;
  }
}

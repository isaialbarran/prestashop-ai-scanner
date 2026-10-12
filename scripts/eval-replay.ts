// Rehace sin red los informes guardados con el código actual: checks sobre el snapshot (con su extracción),
// detección sobre las respuestas guardadas de ChatGPT y Perplexity, y redacción. Sirve para medir la fidelidad
// de un prompt nuevo sin pagar otra vez las búsquedas. Los informes llevan run.tag = "replay".
// Uso: pnpm eval:replay --from stability --runs 1,2 --out fidelity-v2
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { runAllChecks } from "../src/checks/index";
import { REPORTS_DIR } from "../src/evals/datasets";
import { listReports, loadSnapshot, REPLAY_TAG } from "../src/evals/sources";
import { toEur } from "../src/llm/cost";
import { writeReport } from "../src/llm/report";
import type { Llm, LlmCall } from "../src/llm/types";
import { runVisibility, storeIdentity } from "../src/llm/visibility";
import { ReportResultSchema, type ReportResult } from "../src/schema";
import { computeScore } from "../src/scoring/score";
import { evalLlm } from "../evals/lib";

const { values } = parseArgs({ options: { from: { type: "string" }, runs: { type: "string" }, out: { type: "string" } } });
if (!values.from || !values.out) {
  console.error("Uso: pnpm eval:replay --from stability --runs 1,2 --out fidelity-v2");
  process.exit(2);
}
const runs = values.runs ? new Set(values.runs.split(",").map(Number)) : null;
const { llm, ledger } = evalLlm();
await mkdir(path.join(REPORTS_DIR, values.out), { recursive: true });

let written = 0;
for (const { file, report: stored } of listReports(undefined, values.from)) {
  if (runs && !runs.has(stored.run.index ?? -1)) continue;
  const snapshot = loadSnapshot(stored.domain);
  if (!snapshot || JSON.stringify(snapshot.products.map((p) => p.url)) !== JSON.stringify(stored.scan.pages.products)) {
    console.log(`  ${file}: sin snapshot de las mismas fichas, se salta`);
    continue;
  }
  const first = ledger.calls.length;

  const checks = runAllChecks(snapshot);
  const scan = { ...stored.scan, id: randomUUID(), scannedAt: new Date().toISOString(), checks, score: computeScore(checks) };
  const visibility = await runVisibility(stored.visibility.queries, storeIdentity(snapshot), replaying(stored, llm), {
    providers: stored.visibility.providers,
  });
  const { report } = await writeReport(scan, visibility, llm);

  const calls = ledger.calls.slice(first);
  const costUsd = calls.reduce((s, c) => s + c.costUsd, 0);
  const byPurpose: ReportResult["cost"]["byPurpose"] = {};
  for (const c of calls) {
    byPurpose[c.purpose] ??= { calls: 0, costUsd: 0 };
    byPurpose[c.purpose]!.calls++;
    byPurpose[c.purpose]!.costUsd += c.costUsd;
  }
  const result = ReportResultSchema.parse({
    ...stored,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    run: { tag: REPLAY_TAG, index: stored.run.index },
    scan,
    extraction: snapshot.products.map((p, i) => ({
      url: p.url,
      data: snapshot.extracted?.[i] ?? null,
      truncated: false,
      error: snapshot.extracted?.[i] ? null : "sin extracción en el snapshot",
    })),
    visibility,
    report,
    cost: { totalUsd: costUsd, totalEur: toEur(costUsd), byPurpose, llmCalls: calls.length, cachedCalls: calls.filter((c) => c.fromCache).length },
    latencyMs: 0,
  } satisfies ReportResult);
  await writeFile(path.join(REPORTS_DIR, values.out, `${path.basename(file)}.json`), JSON.stringify(result, null, 2));
  written++;
}
console.log(`✓ ${written} informes en ${path.join(REPORTS_DIR, values.out)} · ${ledger.spentEur().toFixed(3)} € pagados`);

/** Llm que contesta las búsquedas con las respuestas guardadas del informe original y delega lo demás. */
function replaying(stored: ReportResult, real: Llm): Llm {
  return {
    structured: (req) => real.structured(req),
    async search({ provider, model, query }) {
      const queryId = stored.visibility.queries.find((q) => q.text === query)?.id;
      const saved = stored.visibility.answers.find((a) => a.queryId === queryId && a.provider === provider);
      if (!saved) throw new Error(`Sin respuesta guardada para ${provider} «${query}»`);
      if (saved.error) throw new Error(saved.error);
      const call: LlmCall = {
        id: saved.callId,
        purpose: "visibility",
        provider,
        model,
        inputHash: "",
        startedAt: stored.createdAt,
        latencyMs: 0,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, searchCalls: 0 },
        costUsd: 0,
        fromCache: true,
        error: null,
        response: null,
      };
      return {
        answer: {
          provider,
          model,
          text: saved.text ?? "",
          cited: (saved.citations ?? []).map((c) => ({ url: c.url, title: null, domain: c.domain })),
          consulted: [],
          searchQueries: [],
          citationMode: saved.citationMode ?? "annotations",
        },
        call,
      };
    },
  };
}

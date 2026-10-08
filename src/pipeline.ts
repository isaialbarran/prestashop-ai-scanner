import { randomUUID } from "node:crypto";
import type { ScanSnapshot } from "./checks/types";
import { detectChallenge } from "./fetch/challenge";
import { BudgetExceededError, toEur, type CostLedger } from "./llm/cost";
import { extractProduct } from "./llm/extract";
import { buildQueryContext, generateQueries } from "./llm/queries";
import { writeReport } from "./llm/report";
import type { Llm } from "./llm/types";
import { runVisibility, storeIdentity, type VisibilityOptions } from "./llm/visibility";
import { collectSnapshot, evaluateSnapshot, type ScanOptions } from "./scan";
import { ReportResultSchema, type ReportResult } from "./schema";

export interface ReportOptions extends ScanOptions {
  llm: Llm;
  /** Un ledger por informe: corta si el informe pasa de 2 €. */
  ledger: CostLedger;
  visibility?: VisibilityOptions;
}

/**
 * Informe completo de un dominio:
 * escaneo → extracción "como bot" (C2) → nota → consultas → visibilidad → titular y hallazgos.
 */
export async function runReport(input: string, opts: ReportOptions): Promise<{ result: ReportResult; snapshot: ScanSnapshot }> {
  const started = performance.now();
  const { snapshot, errors } = await collectSnapshot(input, opts);
  if (snapshot.products.length === 0) throw new Error(`${snapshot.domain}: sin fichas de producto, no se puede generar el informe`);

  const extraction = await Promise.all(
    snapshot.products.map(async (p) => {
      const res = p.fetches.browser?.[0] ?? null;
      if (!res || res.status !== 200 || detectChallenge(res)) {
        return { url: p.url, data: null, truncated: false, error: "la ficha no cargó para el navegador" };
      }
      try {
        const { data, truncated } = await extractProduct(res, opts.llm);
        return { url: p.url, data, truncated, error: null };
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        return { url: p.url, data: null, truncated: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  snapshot.extracted = extraction.map((e) => e.data);
  const scan = evaluateSnapshot(snapshot, { fetcher: opts.fetcher, started, errors });

  const { queries } = await generateQueries(buildQueryContext(snapshot), opts.llm);
  const visibility = await runVisibility(queries, storeIdentity(snapshot), opts.llm, opts.visibility);
  const { report } = await writeReport(scan, visibility, opts.llm);

  const calls = opts.ledger.calls;
  const totalUsd = opts.ledger.reportCostUsd();
  const result = ReportResultSchema.parse({
    id: randomUUID(),
    domain: scan.domain,
    createdAt: new Date().toISOString(),
    scan,
    extraction,
    visibility,
    report,
    cost: {
      totalUsd,
      totalEur: toEur(totalUsd),
      byPurpose: opts.ledger.byPurpose(),
      llmCalls: calls.length,
      cachedCalls: calls.filter((c) => c.fromCache).length,
    },
    latencyMs: Math.round(performance.now() - started),
  } satisfies ReportResult);
  return { result, snapshot };
}

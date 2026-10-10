import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmCall } from "../llm/types";
import type { ReportResult } from "../schema";
import { saveScan } from "./scans";

/** Guarda el escaneo, el informe y cada llamada LLM (tablas scans, reports y llm_calls). */
export async function saveReport(client: SupabaseClient, result: ReportResult, calls: LlmCall[]): Promise<void> {
  await saveScan(client, result.scan);
  const { error } = await client.from("reports").insert({
    id: result.id,
    scan_id: result.scan.id,
    domain: result.domain,
    created_at: result.createdAt,
    score: result.scan.score.final,
    cited_in: result.visibility.citedIn,
    answers: result.visibility.total,
    cost_usd: result.cost.totalUsd,
    latency_ms: result.latencyMs,
    run_tag: result.run.tag,
    run_index: result.run.index,
    result,
  });
  if (error) throw new Error(`Supabase reports: ${error.message}`);
  await saveLlmCalls(client, calls, result.domain, result.id);
}

/** También se usa cuando un informe se corta por presupuesto: el coste gastado queda registrado. */
export async function saveLlmCalls(client: SupabaseClient, calls: LlmCall[], domain: string, reportId: string | null): Promise<void> {
  if (calls.length === 0) return;
  const { error } = await client.from("llm_calls").insert(
    calls.map((c) => ({
      id: c.id,
      report_id: reportId,
      domain,
      purpose: c.purpose,
      provider: c.provider,
      model: c.model,
      input_hash: c.inputHash,
      started_at: c.startedAt,
      latency_ms: c.latencyMs,
      input_tokens: c.usage.inputTokens,
      cached_input_tokens: c.usage.cachedInputTokens,
      output_tokens: c.usage.outputTokens,
      reasoning_tokens: c.usage.reasoningTokens,
      search_calls: c.usage.searchCalls,
      cost_usd: c.costUsd,
      from_cache: c.fromCache,
      error: c.error,
      response: c.response,
    })),
  );
  if (error) throw new Error(`Supabase llm_calls: ${error.message}`);
}

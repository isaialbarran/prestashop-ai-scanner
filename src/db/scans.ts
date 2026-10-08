import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanResult } from "../schema";

/** Guarda un ScanResult en la tabla scans (supabase/migrations). */
export async function saveScan(client: SupabaseClient, result: ScanResult): Promise<void> {
  const { error } = await client.from("scans").insert({
    id: result.id,
    domain: result.domain,
    scanned_at: result.scannedAt,
    scanner_version: result.scannerVersion,
    score: result.score.final,
    band: result.score.band,
    coverage: result.score.coverage,
    capped: result.score.cap !== null,
    result,
  });
  if (error) throw new Error(`Supabase: ${error.message}`);
}

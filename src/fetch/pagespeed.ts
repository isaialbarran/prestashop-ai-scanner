import { POLITENESS } from "../../config/scanner";
import type { FetchImpl } from "./types";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export interface FieldMetric {
  /** p75. CLS ya dividido entre 100 (la API lo devuelve ×100). */
  p75: number;
  /** FAST = verde, AVERAGE = mejorable, SLOW = malo. */
  category: string;
}

export interface PageSpeedResult {
  requestedUrl: string;
  /** De dónde salen los datos de campo: de la URL, del origen o de ninguno. */
  source: "url" | "origin" | null;
  metrics: { lcp: FieldMetric | null; inp: FieldMetric | null; cls: FieldMetric | null };
  error: string | null;
}

type Experience = { metrics?: Record<string, { percentile?: number; category?: string }> } | undefined;

export function parsePageSpeed(requestedUrl: string, json: unknown): PageSpeedResult {
  const data = json as { loadingExperience?: Experience; originLoadingExperience?: Experience };
  const pick = (exp: Experience) => {
    const m = exp?.metrics;
    if (!m) return null;
    const metric = (key: string, scale = 1): FieldMetric | null => {
      const v = m[key];
      return v?.percentile === undefined || !v.category ? null : { p75: v.percentile / scale, category: v.category };
    };
    const metrics = {
      lcp: metric("LARGEST_CONTENTFUL_PAINT_MS"),
      inp: metric("INTERACTION_TO_NEXT_PAINT"),
      cls: metric("CUMULATIVE_LAYOUT_SHIFT_SCORE", 100),
    };
    return metrics.lcp || metrics.inp || metrics.cls ? metrics : null;
  };

  const url = pick(data.loadingExperience);
  if (url) return { requestedUrl, source: "url", metrics: url, error: null };
  const origin = pick(data.originLoadingExperience);
  if (origin) return { requestedUrl, source: "origin", metrics: origin, error: null };
  return { requestedUrl, source: null, metrics: { lcp: null, inp: null, cls: null }, error: null };
}

/** Pide los datos de campo (CrUX) de una URL a la API de PageSpeed Insights. La clave va en cabecera, no en la URL. */
export async function fetchPageSpeed(
  url: string,
  apiKey: string,
  fetchImpl: FetchImpl = (u, i) => fetch(u, i),
): Promise<PageSpeedResult> {
  const query = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  try {
    const res = await fetchImpl(`${ENDPOINT}?${query}`, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(POLITENESS.timeoutMs * 4),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const message = (JSON.parse(body || "{}") as { error?: { message?: string } }).error?.message;
      return { ...parsePageSpeed(url, {}), error: `PageSpeed ${res.status}${message ? `: ${message}` : ""}` };
    }
    return parsePageSpeed(url, await res.json());
  } catch (err) {
    return { ...parsePageSpeed(url, {}), error: err instanceof Error ? err.message : String(err) };
  }
}

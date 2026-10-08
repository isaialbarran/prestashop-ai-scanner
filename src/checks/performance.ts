import { THRESHOLDS } from "../../config/scanner";
import type { FieldMetric } from "../fetch/pagespeed";
import type { Check } from "../schema";
import type { ScanContext } from "./context";
import { inconclusive, makeCheck, statusFromScores } from "./helpers";

export function checkE1(ctx: ScanContext): Check {
  const samples = ctx.products
    .map((p) => p.browser?.ttfbMs)
    .filter((t): t is number => typeof t === "number");
  const url = ctx.products[0]?.url ?? ctx.snap.origin ?? ctx.snap.domain;
  if (samples.length === 0) return inconclusive("E1", url, "Ninguna ficha respondió al navegador");

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  const ok = median < THRESHOLDS.e1MaxTtfbMs;
  return makeCheck("E1", {
    status: ok ? "pass" : "fail",
    score: ok ? 1 : 0,
    evidence: [
      {
        url,
        agent: "browser",
        note: `Mediana de TTFB ${median} ms en ${samples.length} fichas (${samples.join(", ")} ms), medido desde el escáner`,
      },
    ],
    fix: ok
      ? null
      : "Reduce el tiempo de respuesta del servidor: activa la caché de PrestaShop (Smarty y una caché de página completa), revisa módulos lentos en el perfilador y considera un hosting más cercano a tus clientes.",
  });
}

export function checkE2(ctx: ScanContext): Check {
  const psi = ctx.snap.pagespeed;
  const url = psi?.requestedUrl ?? ctx.products[0]?.url ?? ctx.snap.origin ?? ctx.snap.domain;
  if (!psi) return inconclusive("E2", url, "No se consultó PageSpeed Insights (falta PAGESPEED_API_KEY)");
  if (psi.error) return inconclusive("E2", url, `PageSpeed Insights falló: ${psi.error}`);
  if (!psi.source) return inconclusive("E2", url, "Sin datos de campo (CrUX) ni para la URL ni para el origen: la tienda no tiene tráfico suficiente");

  const { lcp, inp, cls } = psi.metrics;
  const green = (m: FieldMetric | null) => (m ? (m.category === "FAST" ? 1 : 0) : null);
  const { status, score } = statusFromScores([green(lcp), green(inp), green(cls)]);
  const fmt = (label: string, m: FieldMetric | null, unit: string) =>
    m ? `${label} p75 ${m.p75}${unit} (${m.category})` : `${label} sin datos`;
  return makeCheck("E2", {
    status,
    score,
    evidence: [
      {
        url,
        note: `${fmt("LCP", lcp, " ms")}, ${fmt("INP", inp, " ms")}, ${fmt("CLS", cls, "")}; datos de ${psi.source === "url" ? "la propia URL" : "todo el origen"}`,
      },
    ],
    fix:
      status === "pass"
        ? null
        : "Mejora las métricas que no están en verde: imágenes WebP con tamaño fijo para LCP y CLS, menos JavaScript de módulos en la ficha para INP.",
  });
}

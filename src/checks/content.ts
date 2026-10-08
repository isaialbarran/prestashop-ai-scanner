import { THRESHOLDS } from "../../config/scanner";
import type { Check, Evidence } from "../schema";
import type { ProductContext, ScanContext } from "./context";
import { evidenceFrom, inconclusive, makeCheck, statusFromScores } from "./helpers";

interface ProductOutcome {
  score: number | null;
  evidence: Evidence;
}

/** Calcula un check por ficha y promedia (regla del brief para B y C). */
export function perProduct(
  id: Check["id"],
  ctx: ScanContext,
  evaluate: (p: ProductContext) => ProductOutcome,
  fix: (score: number) => string | null,
): Check {
  if (ctx.products.length === 0) return inconclusive(id, ctx.snap.origin ?? ctx.snap.domain, "No se encontraron fichas de producto");
  const outcomes = ctx.products.map((p) =>
    p.page
      ? evaluate(p)
      : {
          score: null,
          evidence: evidenceFrom(p.browser, `La ficha no devolvió 200 al navegador (${p.browser?.status ?? p.browser?.error ?? "sin respuesta"})`, {
            url: p.url,
          }),
        },
  );
  const { status, score } = statusFromScores(outcomes.map((o) => o.score));
  return makeCheck(id, {
    status,
    score,
    evidence: outcomes.map((o) => o.evidence),
    fix: status === "pass" || status === "inconclusive" ? null : fix(score),
  });
}

const show = (v: string | null | undefined) => (v ? `✓ «${v.length > 60 ? `${v.slice(0, 59)}…` : v}»` : "✗");

export function checkB1(ctx: ScanContext): Check {
  return perProduct(
    "B1",
    ctx,
    (p) => {
      const s = p.page!.signals;
      const found = [s.name, s.price, s.availability].filter(Boolean).length;
      return {
        score: found / 3,
        evidence: evidenceFrom(
          p.browser,
          `Nombre ${show(s.name)}, precio ${show(s.price?.text)}, disponibilidad ${show(s.availability?.text)}`,
        ),
      };
    },
    () =>
      "Muestra nombre, precio y disponibilidad en el HTML que envía el servidor. Si los pinta JavaScript (tema SPA, módulo de precios dinámicos o carga por AJAX), los rastreadores no los ven.",
  );
}

export function checkB2(ctx: ScanContext): Check {
  const min = THRESHOLDS.b2MinDescriptionChars;
  return perProduct(
    "B2",
    ctx,
    (p) => {
      const d = p.page!.signals.description;
      const length = d?.text.length ?? 0;
      return {
        score: Math.min(1, length / min),
        evidence: evidenceFrom(
          p.browser,
          d
            ? `${length} caracteres de descripción (${d.heuristic ? "detectada por heurística" : d.selector})`
            : "No hay descripción en el HTML inicial",
          d ? { snippet: d.text } : {},
        ),
      };
    },
    () =>
      `Escribe al menos ${min} caracteres de descripción con los atributos que busca un comprador (material, medidas, uso) y asegúrate de que salen en el HTML, no en una pestaña cargada por AJAX.`,
  );
}

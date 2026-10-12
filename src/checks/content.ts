import { THRESHOLDS } from "../../config/scanner";
import type { Check, Evidence } from "../schema";
import type { ProductContext, ScanContext } from "./context";
import { evidenceFrom, inconclusive, makeCheck, statusFromScores } from "./helpers";

interface ProductOutcome {
  score: number | null;
  evidence: Evidence;
  /** Lo que falla en esta ficha; el arreglo nombra solo eso. */
  missing?: string[];
}

/** Une lo que falta en las fichas, sin repetir y en el orden en que aparece. */
const union = (lists: (string[] | undefined)[]) => [...new Set(lists.flatMap((l) => l ?? []))];

/** «a», «a y b», «a, b y c». */
export const listEs = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);

/** Calcula un check por ficha y promedia (regla del brief para B y C). */
export function perProduct(
  id: Check["id"],
  ctx: ScanContext,
  evaluate: (p: ProductContext) => ProductOutcome,
  fix: (missing: string[], score: number) => string | null,
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
    fix: status === "pass" || status === "inconclusive" ? null : fix(union(outcomes.map((o) => o.missing)), score),
  });
}

const show = (v: string | null | undefined) => (v ? `✓ «${v.length > 60 ? `${v.slice(0, 59)}…` : v}»` : "✗");

export function checkB1(ctx: ScanContext): Check {
  return perProduct(
    "B1",
    ctx,
    (p) => {
      const s = p.page!.signals;
      const fields = [
        ["el nombre", s.name],
        ["el precio", s.price],
        ["la disponibilidad", s.availability],
      ] as const;
      return {
        score: fields.filter(([, v]) => v).length / 3,
        evidence: evidenceFrom(
          p.browser,
          `Nombre ${show(s.name)}, precio ${show(s.price?.text)}, disponibilidad ${show(s.availability?.text)}`,
        ),
        missing: fields.filter(([, v]) => !v).map(([label]) => label),
      };
    },
    (missing) =>
      `Haz que ${listEs(missing)} ${missing.length > 1 ? "salgan" : "salga"} en el HTML que envía el servidor: si ${missing.length > 1 ? "los pinta" : "lo pinta"} JavaScript, los rastreadores no ${missing.length > 1 ? "los" : "lo"} ven.`,
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
        missing: !d ? ["sin descripción"] : length < min ? ["corta"] : [],
      };
    },
    (missing) =>
      [
        missing.includes("sin descripción") ? "Haz que la descripción salga en el HTML inicial de la ficha: si la carga JavaScript, los rastreadores no la ven." : null,
        missing.includes("corta") ? `Amplía la descripción de las fichas con menos de ${min} caracteres.` : null,
      ]
        .filter(Boolean)
        .join(" "),
  );
}

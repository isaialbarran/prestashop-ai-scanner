import { z } from "zod";
import { MODELS } from "../../config/models";
import type { Check, ReportText, ScanResult, VisibilityResult } from "../schema";
import type { Llm, LlmCall } from "./types";

const DraftSchema = z.object({
  headline: z.string(),
  findings: z.array(z.string()),
});

const REF = /\[([A-Z]\d|q\d{1,2})\]/g;

/** Frases de un texto; cada una debe llevar al menos una referencia [A2] o [q3]. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?](?:\s*\[[^\]]+\])*)\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Regla del brief: cada frase referencia un check o una consulta concreta; si no hay evidencia, no se escribe.
 * Se conservan las frases cuyas referencias existen todas y se descartan las demás.
 */
export function enforceEvidence(text: string, validIds: Set<string>): { kept: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const sentence of splitSentences(text)) {
    const refs = [...sentence.matchAll(REF)].map((m) => m[1]!);
    if (refs.length > 0 && refs.every((r) => validIds.has(r))) kept.push(sentence);
    else dropped.push(sentence);
  }
  return { kept: kept.join(" "), dropped };
}

/**
 * Checks que pierden puntos, del que más al que menos. La prioridad se calcula aquí y no la decide el modelo:
 * en la v1 llamaba «prioritario» a problemas sin nada que lo respaldara.
 */
export function pointsLost(checks: Check[]): { id: string; lost: number }[] {
  return checks
    .filter((c) => c.maxPoints > 0 && (c.status === "fail" || c.status === "hint"))
    .map((c) => ({ id: c.id, lost: Math.round((c.maxPoints - c.points) * 10) / 10 }))
    .filter((c) => c.lost > 0)
    .sort((a, b) => b.lost - a.lost);
}

/** Resumen compacto del ScanResult y de la visibilidad para el prompt. */
export function reportContext(scan: ScanResult, visibility: VisibilityResult): string {
  const checks = scan.checks
    .filter((c) => c.maxPoints > 0 || c.status !== "inconclusive")
    .map((c) => {
      const notes = c.evidence
        .slice(0, 4)
        .map((e) => e.note)
        .join(" / ");
      return `[${c.id}] ${c.title}: ${c.status}, ${c.points}/${c.maxPoints}. ${notes}${c.fix ? ` Arreglo: ${c.fix}` : ""}`;
    });
  const queries = visibility.queries.map((q) => {
    const answers = visibility.answers.filter((a) => a.queryId === q.id && !a.error);
    const cited = answers.filter((a) => a.cited).map((a) => `${a.provider} (${a.method === "domain" ? "enlace" : "mención"})`);
    const others = [...new Set(answers.flatMap((a) => a.citedDomains))].slice(0, 5);
    return `[${q.id}] "${q.text}": ${cited.length ? `cita la tienda: ${cited.join(", ")}` : "no cita la tienda"}; dominios citados: ${others.join(", ") || "ninguno"}`;
  });
  const ranking = pointsLost(scan.checks)
    .map((c) => `${c.id} −${String(c.lost).replace(".", ",")}`)
    .join(" · ");
  const by = Object.entries(visibility.byProvider)
    .map(([p, v]) => `${p} ${v!.cited}/${v!.total}`)
    .join(", ");
  return [
    `Tienda: ${scan.domain}. Fichas analizadas: ${scan.pages.products.length} (en los checks por ficha, cada evidencia es una ficha). Nota técnica: ${scan.score.final ?? "sin nota"}${scan.score.cap ? ` (topada en ${scan.score.cap}: ${scan.score.capReasons.join("; ")})` : ""}, tramo ${scan.score.band ?? "—"}, cobertura ${Math.round(scan.score.coverage * 100)} %.`,
    "",
    "Comprobaciones (✓ = está o coincide; ✗ = falta o no coincide):",
    ...checks,
    "",
    `Prioridad técnica (puntos perdidos): ${ranking || "ninguno pierde puntos"}.${scan.score.cap ? " El tope de la nota va antes que todo lo demás." : ""}`,
    "",
    `Visibilidad: citada en ${visibility.citedIn} de ${visibility.total} respuestas (${by}). Competidores más citados: ${visibility.topCompetitors.map((c) => `${c.domain} (${c.answers})`).join(", ") || "ninguno"}.`,
    ...queries,
  ].join("\n");
}

export async function writeReport(
  scan: ScanResult,
  visibility: VisibilityResult,
  llm: Llm,
): Promise<{ report: ReportText; call: LlmCall }> {
  const { data, call } = await llm.structured({
    purpose: "report",
    model: MODELS.report,
    name: "store_report",
    schema: DraftSchema,
    system: [
      "Redactas el resumen de un informe técnico para el dueño de una tienda PrestaShop española, en español de España, claro y directo.",
      "Solo puedes usar los datos que se te dan. No inventes cifras, causas ni recomendaciones que no estén en los datos.",
      "Cada frase termina con la referencia entre corchetes del check o la consulta que la respalda, por ejemplo [C4] o [q3]. Una frase sin referencia se eliminará.",
      "Cada referencia debe respaldar exactamente lo que dice su frase; no cites una consulta que no trate de lo que afirmas.",
      "En la evidencia, ✓ significa que el dato está o que coincide, y ✗ que falta o no coincide: nunca presentes como problema algo marcado con ✓.",
      "No cuentes ni sumes: usa solo números que aparezcan tal cual en los datos.",
      "Un competidor solo se atribuye a las consultas en cuyos dominios citados aparece.",
      "La prioridad la da la línea «Prioridad técnica»: no llames prioritario, principal ni más grave a otro problema que el primero de esa lista.",
      "No escribas frases sobre los propios datos («no se especifica», «los datos no indican»): si algo no está, no lo menciones.",
      "Escribe cada arreglo como una orden («Añade…», «Corrige…», «Haz que…»), para que no se lea como algo que la tienda ya hace.",
    ].join(" "),
    user: [
      "Escribe:",
      "- headline: un titular de una o dos frases con lo más importante: la visibilidad en IA y el primer problema de «Prioridad técnica».",
      "- findings: exactamente 3 hallazgos, en el orden de «Prioridad técnica», salvo que uno trate de visibilidad: las consultas donde aparecen competidores pero no la tienda. Cada uno con el problema, la evidencia y el arreglo, en 2 o 3 frases.",
      "",
      reportContext(scan, visibility),
    ].join("\n"),
  });

  const validIds = new Set<string>([...scan.checks.map((c) => c.id), ...visibility.queries.map((q) => q.id)]);
  const dropped: string[] = [];
  const headline = enforceEvidence(data.headline, validIds);
  dropped.push(...headline.dropped);
  const findings = data.findings.slice(0, 3).map((f) => {
    const r = enforceEvidence(f, validIds);
    dropped.push(...r.dropped);
    return r.kept;
  });
  return {
    report: { model: MODELS.report, headline: headline.kept || null, findings: findings.filter(Boolean), dropped },
    call,
  };
}

import { z } from "zod";
import { MODELS } from "../../config/models";
import type { ReportText, ScanResult, VisibilityResult } from "../schema";
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

/** Resumen compacto del ScanResult y de la visibilidad para el prompt. */
export function reportContext(scan: ScanResult, visibility: VisibilityResult): string {
  const checks = scan.checks
    .filter((c) => c.maxPoints > 0 || c.status !== "inconclusive")
    .map((c) => {
      const notes = c.evidence
        .slice(0, 2)
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
  const by = Object.entries(visibility.byProvider)
    .map(([p, v]) => `${p} ${v!.cited}/${v!.total}`)
    .join(", ");
  return [
    `Tienda: ${scan.domain}. Nota técnica: ${scan.score.final ?? "sin nota"}${scan.score.cap ? ` (topada en ${scan.score.cap}: ${scan.score.capReasons.join("; ")})` : ""}, tramo ${scan.score.band ?? "—"}, cobertura ${Math.round(scan.score.coverage * 100)} %.`,
    "",
    "Comprobaciones:",
    ...checks,
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
    ].join(" "),
    user: [
      "Escribe:",
      "- headline: un titular de una o dos frases con lo más importante (visibilidad en IA y el problema técnico de más peso).",
      "- findings: exactamente 3 hallazgos, ordenados por impacto. Cada uno con el problema, la evidencia y el arreglo, en 2 o 3 frases.",
      "Prioriza los checks con fail o hint y más puntos perdidos, y las consultas donde aparecen competidores pero no la tienda.",
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

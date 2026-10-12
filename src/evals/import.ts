import type { z } from "zod";
import { parseCsv } from "./csv";
import { LABEL_SCHEMAS, type Kind } from "./datasets";

/** Columnas de las plantillas (en español) → campos de las etiquetas. */
const COLUMNS: Record<Exclude<Kind, "detection">, Record<string, string>> = {
  checks: { id: "id", dominio: "domain", check: "check", estado_escaner: "scannerStatus", de_acuerdo: "agree", estado_correcto: "correctStatus", nota: "note" },
  extraction: {
    id: "id",
    dominio: "domain",
    indice: "productIndex",
    url: "url",
    nombre: "name",
    precio: "price",
    moneda: "currency",
    disponibilidad: "availability",
    gtin: "gtin",
    marca: "brand",
    nota: "note",
  },
  fidelity: { id: "id", informe: "report", dominio: "domain", parte: "part", frase: "sentence", referencias: "refs", respaldada: "supported", nota: "note" },
};

/** Columna que dice si la fila ya está etiquetada; las filas sin ella se ignoran. */
const DONE: Record<Exclude<Kind, "detection">, string> = { checks: "de_acuerdo", extraction: "revisada", fidelity: "respaldada" };

export interface ImportResult<T> {
  labels: T[];
  skipped: number;
  errors: string[];
}

export function importRows(kind: Exclude<Kind, "detection">, rows: Record<string, string>[]): ImportResult<unknown> {
  const schema = LABEL_SCHEMAS[kind] as z.ZodType<unknown>;
  const labels: unknown[] = [];
  const errors: string[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    if (!row[DONE[kind]]?.trim()) {
      skipped++;
      return;
    }
    const mapped = Object.fromEntries(Object.entries(COLUMNS[kind]).map(([col, key]) => [key, row[col] ?? ""]));
    const parsed = schema.safeParse(mapped);
    if (parsed.success) labels.push(parsed.data);
    else errors.push(`fila ${i + 2} (${row.id}): ${parsed.error.issues.map((x) => `${x.path.join(".") || "fila"} ${x.message}`).join("; ")}`);
  });
  return { labels, skipped, errors };
}

/** Une etiquetas nuevas con las existentes; si un id se repite, gana la nueva. */
export function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((l) => [l.id, l]));
  for (const l of incoming) map.set(l.id, l);
  return [...map.values()];
}

/** Copia en `rows` las columnas de etiqueta ya rellenadas en la plantilla anterior (mismo id). Devuelve cuántas filas conservan algo. */
export function carryOverLabels(previousCsv: string | null, rows: Record<string, unknown>[], labelColumns: string[]): number {
  if (!previousCsv) return 0;
  const previous = new Map(parseCsv(previousCsv).map((r) => [r.id, r]));
  let kept = 0;
  for (const row of rows) {
    const old = previous.get(String(row.id));
    if (!old || !labelColumns.some((c) => old[c])) continue;
    for (const c of labelColumns) row[c] = old[c] ?? "";
    kept++;
  }
  return kept;
}

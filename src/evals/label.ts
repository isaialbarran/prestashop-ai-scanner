import { load } from "cheerio";
import { z } from "zod";
import { AVAILABILITY } from "../llm/extract";
import { collapse } from "../parse/html";
import { isValidGtin } from "../parse/product";
import type { Kind } from "./datasets";

/** Partes puras del asistente de etiquetado (scripts/label.ts): textos y conversión de respuestas. */

export const CHECK_GUIDE: Record<string, { title: string; how: string }> = {
  A2: {
    title: "La ficha responde igual a un rastreador que a un navegador",
    how: "¿Los rastreadores reciben la misma ficha que el navegador? «fail» solo si el navegador la recibe y el rastreador no (403, 429, reto, timeout solo para él). Si el navegador tampoco la recibe, lo justo es «inconcluso».",
  },
  C2: {
    title: "El Offer (marcado) dice el mismo precio, moneda y disponibilidad que la ficha",
    how: "Abre la ficha y su código fuente (Cmd+Opción+U) y busca «price» o «availability». ¿Coinciden con lo que se ve? En stock y «últimas unidades» cuentan como lo mismo.",
  },
  C3: {
    title: "Identificadores: GTIN válido o MPN, más marca y SKU",
    how: "En el código fuente, el bloque Product (application/ld+json o itemprop): ¿tiene gtin/ean válido o mpn, brand y sku? «pass» con todo, «hint» con parte, «fail» sin nada.",
  },
};

export const STATUS_KEYS: Record<string, "pass" | "fail" | "hint" | "inconclusive"> = {
  p: "pass",
  f: "fail",
  h: "hint",
  i: "inconclusive",
};

export const AVAILABILITY_MENU: { key: string; value: (typeof AVAILABILITY)[number]; text: string }[] = [
  { key: "1", value: "InStock", text: "en stock, disponible, entrega en 24 h" },
  { key: "2", value: "LimitedAvailability", text: "últimas unidades, quedan pocas" },
  { key: "3", value: "OutOfStock", text: "agotado, sin stock, no disponible" },
  { key: "4", value: "BackOrder", text: "bajo pedido, disponible en X días" },
  { key: "5", value: "PreOrder", text: "preventa, próximamente" },
  { key: "6", value: "Discontinued", text: "descatalogado" },
];

/** Respuesta a la pregunta de disponibilidad: número del menú o vacío (no aparece). */
export function availabilityFromKey(input: string): (typeof AVAILABILITY)[number] | null | undefined {
  const t = input.trim();
  if (t === "") return null;
  return AVAILABILITY_MENU.find((m) => m.key === t)?.value;
}

/** Campo de texto: Enter acepta la sugerencia (si la hay), «-» = no aparece, otra cosa = ese valor. */
export function textAnswer(input: string, suggestion: string | null): string | null {
  const t = input.trim();
  if (t === "-") return null;
  if (t === "") return suggestion;
  return t;
}

const compact = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Título principal de la vista como bot: solo sirve de sugerencia para el nombre (texto de la página, no una predicción).
 * Hay temas que ponen el nombre de la web en un <h1>; si hay otro, se sugiere ese.
 */
export function headingOf(html: string, domain?: string): string | null {
  const $ = load(html);
  const headings = $("h1")
    .toArray()
    .map((h) => collapse($(h).text()))
    .filter(Boolean);
  const site = domain ? compact(domain.replace(/^www\./, "").split(".")[0]!) : "";
  const product = site ? headings.find((h) => !compact(h).startsWith(site)) : undefined;
  return product ?? headings[0] ?? null;
}

/** EAN/GTIN tecleado: un único grupo de 8 a 14 dígitos; valid = el dígito de control cuadra. null = no se entiende. */
export function gtinFromInput(input: string): { gtin: string; valid: boolean } | null {
  const groups = input.match(/\d+/g) ?? [];
  const codes = groups.filter((g) => g.length >= 8);
  if (codes.length !== 1 || codes[0]!.length > 14) return null;
  return { gtin: codes[0]!, valid: isValidGtin(codes[0]!) };
}

/** Lista de revisión (data/private/evals/revisar.json): casos que el análisis de errores marcó como dudosos. */
export const ReviewListSchema = z.record(
  z.string(),
  z.array(z.object({ id: z.string(), reason: z.string(), reviewed: z.boolean().default(false) })),
);
export type ReviewList = z.infer<typeof ReviewListSchema>;

/** La etiqueta anterior en una línea, para decidir si se mantiene. */
export function labelSummary(kind: Kind, label: Record<string, unknown>): string {
  const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : String(x));
  const note = label.note ? ` · nota: ${label.note}` : "";
  switch (kind) {
    case "extraction":
      return `nombre ${v(label.name)} · precio ${v(label.price)} · moneda ${v(label.currency)} · disponibilidad ${v(label.availability)} · gtin ${v(label.gtin)} · marca ${v(label.brand)}`;
    case "detection":
      return `${label.label ? "sí la cita" : "no la cita"}${note}`;
    case "fidelity":
      return `${label.supported ? "respaldada" : "no respaldada"}${note}`;
    case "checks":
      return `${label.agree ? "de acuerdo" : `estado correcto ${v(label.correctStatus)}`}${note}`;
  }
}

/** La evidencia de las plantillas viene unida con « | » o « || »; en pantalla, una línea por elemento. */
export function evidenceLines(evidence: string): string[] {
  return evidence
    .split(/\s\|\|?\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function progress(done: number, total: number): string {
  const width = 20;
  const filled = total ? Math.round((done / total) * width) : 0;
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${done}/${total}`;
}

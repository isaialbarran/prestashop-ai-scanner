import { load } from "cheerio";
import { AVAILABILITY } from "../llm/extract";
import { collapse } from "../parse/html";

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

/** Título principal de la vista como bot: solo sirve de sugerencia para el nombre (texto de la página, no una predicción). */
export function headingOf(html: string): string | null {
  const $ = load(html);
  return collapse($("h1").first().text()) || null;
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

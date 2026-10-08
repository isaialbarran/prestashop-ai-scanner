import { normalizeDomain } from "../scan";

const HEADERS = new Set(["domain", "dominio", "url", "web", "tienda"]);

/** Primera columna de cada línea como dominio; ignora cabecera, comentarios, vacíos y duplicados. */
export function parseDomains(csv: string): string[] {
  const seen = new Set<string>();
  for (const line of csv.split(/\r?\n/)) {
    const cell = line.trim().split(/[,;\t]/)[0]?.trim().replace(/^"|"$/g, "") ?? "";
    if (!cell || cell.startsWith("#") || HEADERS.has(cell.toLowerCase())) continue;
    const domain = normalizeDomain(cell);
    if (domain.includes(".")) seen.add(domain);
  }
  return [...seen];
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

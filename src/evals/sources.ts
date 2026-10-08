import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ScanSnapshot } from "../checks/types";
import { ReportResultSchema, type ReportResult } from "../schema";
import { REPORTS_DIR, SNAPSHOTS_DIR } from "./datasets";

/** Snapshot guardado por `pnpm batch --mode extract|report` (respuestas HTTP y extracción). */
export function loadSnapshot(domain: string, dir = SNAPSHOTS_DIR): ScanSnapshot | null {
  const file = path.join(dir, `${domain}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ScanSnapshot) : null;
}

export interface StoredReport {
  /** Ruta relativa a REPORTS_DIR sin extensión, p. ej. `stability/lylotools.es-2`: identifica el informe. */
  file: string;
  report: ReportResult;
}

/** Todos los informes guardados bajo `dir`, en orden estable. Los que no validan se ignoran. */
export function listReports(dir = REPORTS_DIR, subdir = ""): StoredReport[] {
  const root = path.join(dir, subdir);
  if (!existsSync(root)) return [];
  const out: StoredReport[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.join(subdir, entry.name);
    if (entry.isDirectory()) out.push(...listReports(dir, rel));
    else if (entry.name.endsWith(".json")) {
      const parsed = ReportResultSchema.safeParse(JSON.parse(readFileSync(path.join(dir, rel), "utf8")));
      if (parsed.success) out.push({ file: rel.replace(/\.json$/, ""), report: parsed.data });
    }
  }
  return out;
}

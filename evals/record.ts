import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const RESULTS_FILE = path.join(".cache", "evals", "results.jsonl");

export interface EvalRow {
  order: number;
  eval: string;
  dataset: string;
  metric: string;
  value: string;
  threshold: string;
  status: "ok" | "falla" | "medido" | "sin datos";
}

/** Cada eval apunta aquí su fila; el global setup imprime la tabla al final. */
export function record(row: EvalRow): void {
  mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  appendFileSync(RESULTS_FILE, `${JSON.stringify(row)}\n`);
}

export function readRows(): EvalRow[] {
  if (!existsSync(RESULTS_FILE)) return [];
  return readFileSync(RESULTS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvalRow)
    .sort((a, b) => a.order - b.order);
}

export const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;

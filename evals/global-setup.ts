import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readRows, RESULTS_FILE } from "./record";

const ICON = { ok: "✓", falla: "✗", medido: "·", "sin datos": "?" } as const;

export default function setup() {
  rmSync(RESULTS_FILE, { force: true });
  return function teardown() {
    const rows = readRows();
    if (!rows.length) return;
    const header = ["", "Eval", "Dataset", "Métrica", "Valor", "Umbral"];
    const body = rows.map((r) => [ICON[r.status], r.eval, r.dataset, r.metric, r.value, r.threshold]);
    const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
    console.log(`\n${line(header)}\n${widths.map((w) => "─".repeat(w)).join("  ")}\n${body.map(line).join("\n")}\n`);

    mkdirSync("evals/results", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const md = [
      `# Evals · ${date}`,
      "",
      "| | Eval | Dataset | Métrica | Valor | Umbral |",
      "|---|---|---|---|---|---|",
      ...body.map((b) => `| ${b.join(" | ")} |`),
      "",
    ].join("\n");
    writeFileSync("evals/results/latest.md", md);
    writeFileSync("evals/results/latest.json", JSON.stringify({ date, rows }, null, 2));
  };
}

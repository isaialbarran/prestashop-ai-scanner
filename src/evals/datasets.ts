import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AVAILABILITY } from "../llm/extract";
import { parsePrice } from "../parse/product";
import { CheckStatusSchema, ProviderSchema } from "../schema";

/** Fuera de git (repo público): junto al resto de datos privados. Ver evals/README.md. */
export const DATASETS_DIR = process.env.EVALS_DIR ?? "data/private/evals";
export const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR ?? "data/private/snapshots";
export const REPORTS_DIR = process.env.REPORTS_DIR ?? "data/private/reports";

export const KINDS = ["checks", "extraction", "detection", "fidelity"] as const;
export type Kind = (typeof KINDS)[number];

// Lo que se escribe a mano en una hoja de cálculo: sí/no, vacío = null, decimales con coma.
const YES = new Set(["si", "sí", "s", "yes", "y", "true", "1", "x"]);
const NO = new Set(["no", "n", "false", "0"]);
export const yesNo = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim().toLowerCase();
  return YES.has(t) ? true : NO.has(t) ? false : v;
}, z.boolean());
export const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v);
const text = z.preprocess(blankToNull, z.string().nullable());
const price = z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : parsePrice(v)) : v), z.number().nullable());
const availability = z.preprocess(blankToNull, z.enum(AVAILABILITY).nullable());

export const ChecksLabelSchema = z
  .object({
    id: z.string(),
    domain: z.string(),
    check: z.enum(["A2", "C2", "C3"]),
    scannerStatus: CheckStatusSchema,
    agree: yesNo,
    correctStatus: z.preprocess(blankToNull, CheckStatusSchema.nullable()),
    note: text,
  })
  .transform((l) => ({ ...l, correctStatus: l.correctStatus ?? (l.agree ? l.scannerStatus : null) }))
  .refine((l) => l.correctStatus !== null, { message: "Si no estás de acuerdo, indica el estado correcto" });

export const ExtractionLabelSchema = z.object({
  id: z.string(),
  domain: z.string(),
  productIndex: z.coerce.number().int().min(0),
  url: z.string(),
  name: text,
  price,
  currency: z.preprocess((v) => (typeof blankToNull(v) === "string" ? String(v).trim().toUpperCase() : blankToNull(v)), z.string().nullable()),
  availability,
  gtin: text,
  brand: text,
  note: text,
});

export const DetectionLabelSchema = z.object({
  id: z.string(),
  report: z.string(),
  domain: z.string(),
  queryId: z.string(),
  provider: ProviderSchema,
  label: yesNo,
  note: text,
});

export const FidelityLabelSchema = z.object({
  id: z.string(),
  report: z.string(),
  domain: z.string(),
  part: z.string(),
  sentence: z.string(),
  refs: z.preprocess((v) => (typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : v), z.array(z.string())),
  supported: yesNo,
  note: text,
});

export const LABEL_SCHEMAS = {
  checks: ChecksLabelSchema,
  extraction: ExtractionLabelSchema,
  detection: DetectionLabelSchema,
  fidelity: FidelityLabelSchema,
} as const;

export type ChecksLabel = z.output<typeof ChecksLabelSchema>;
export type ExtractionLabel = z.output<typeof ExtractionLabelSchema>;
export type DetectionLabel = z.output<typeof DetectionLabelSchema>;
export type FidelityLabel = z.output<typeof FidelityLabelSchema>;

export const datasetPath = (kind: Kind) => path.join(DATASETS_DIR, `${kind}.jsonl`);

export function readJsonl<T>(file: string, schema: z.ZodType<T>): T[] | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      const parsed = schema.safeParse(JSON.parse(l));
      if (!parsed.success) throw new Error(`${file}:${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      return parsed.data;
    });
}

export function writeJsonl(file: string, rows: unknown[]): void {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

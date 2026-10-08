import { z } from "zod";
import { AGENT_IDS } from "../config/agents";
import { PROVIDERS } from "../config/models";

export const CHECK_IDS = [
  "A1", "A2", "A3",
  "B1", "B2",
  "C1", "C2", "C3", "C4", "C5",
  "D1", "D2", "D3",
  "E1", "E2",
  "I1", "I2", "I3",
] as const;

export const AgentIdSchema = z.enum(AGENT_IDS);
export const CheckIdSchema = z.enum(CHECK_IDS);
export const CheckStatusSchema = z.enum(["pass", "fail", "hint", "inconclusive"]);
/** A2: `origen` = el propio servidor rechaza el agente; `waf` = página de bloqueo o reto de un cortafuegos. */
export const BlockKindSchema = z.enum(["origen", "waf"]);
export const BandSchema = z.enum(["ilegible", "legible con errores", "preparada"]);

export const EvidenceSchema = z.object({
  url: z.string().min(1),
  agent: AgentIdSchema.optional(),
  httpStatus: z.number().int().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  snippet: z.string().max(600).optional(),
  note: z.string().min(1),
});

export const CheckSchema = z
  .object({
    id: CheckIdSchema,
    title: z.string().min(1),
    status: CheckStatusSchema,
    points: z.number().min(0),
    maxPoints: z.number().min(0),
    evidence: z.array(EvidenceSchema).min(1),
    fix: z.string().nullable(),
    perAgent: z.partialRecord(AgentIdSchema, CheckStatusSchema).optional(),
    blockKind: z.partialRecord(AgentIdSchema, BlockKindSchema).optional(),
  })
  .refine((c) => c.points <= c.maxPoints + 1e-9, {
    message: "points no puede superar maxPoints",
    path: ["points"],
  });

export const ScoreSchema = z.object({
  /** Puntos obtenidos en checks concluyentes. */
  earned: z.number().min(0),
  /** Suma de maxPoints de los checks concluyentes. */
  evaluated: z.number().min(0),
  /** Suma de maxPoints de todos los checks. */
  possible: z.number().min(0),
  /** evaluated / possible. */
  coverage: z.number().min(0).max(1),
  /** 100 × earned / evaluated, antes del tope. */
  normalized: z.number().min(0).max(100).nullable(),
  cap: z.number().nullable(),
  capReasons: z.array(z.string()),
  final: z.number().int().min(0).max(100).nullable(),
  band: BandSchema.nullable(),
});

export const ScanResultSchema = z
  .object({
    id: z.uuid(),
    domain: z.string().min(1),
    origin: z.string().nullable(),
    scannedAt: z.iso.datetime(),
    scannerVersion: z.string().min(1),
    platform: z.object({
      prestashop: z.boolean(),
      version: z.string().nullable(),
    }),
    pages: z.object({
      home: z.string().nullable(),
      category: z.string().nullable(),
      products: z.array(z.string()),
    }),
    checks: z.array(CheckSchema),
    score: ScoreSchema,
    requests: z.object({
      network: z.number().int().min(0),
      cached: z.number().int().min(0),
      budget: z.number().int().min(0),
    }),
    durationMs: z.number().min(0),
    errors: z.array(z.string()),
  })
  .refine(
    (r) =>
      r.checks.length === CHECK_IDS.length &&
      new Set(r.checks.map((c) => c.id)).size === CHECK_IDS.length,
    { message: "checks debe incluir cada id exactamente una vez", path: ["checks"] },
  );

export type AgentIdValue = z.infer<typeof AgentIdSchema>;
export type CheckId = z.infer<typeof CheckIdSchema>;
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type BlockKind = z.infer<typeof BlockKindSchema>;
export type Band = z.infer<typeof BandSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type Score = z.infer<typeof ScoreSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;

// ── Capa LLM ────────────────────────────────────────────────────────────────

export const ProviderSchema = z.enum(PROVIDERS);

export const BuyerQuerySchema = z.object({
  id: z.string().regex(/^q\d+$/),
  kind: z.enum(["category", "product", "purchase"]),
  text: z.string().min(1),
  sanitized: z.boolean(),
});

/** Resultado de una consulta en un proveedor. */
export const AnswerOutcomeSchema = z.object({
  queryId: z.string(),
  provider: ProviderSchema,
  model: z.string(),
  callId: z.string(),
  cited: z.boolean(),
  /** `domain`: alguna URL citada es de la tienda; `name`: el texto la nombra (lo decide un LLM barato). */
  method: z.enum(["domain", "name"]).nullable(),
  storeUrls: z.array(z.string()),
  quote: z.string().nullable(),
  citedDomains: z.array(z.string()),
  citationMode: z.enum(["annotations", "markers", "no-markers"]).nullable(),
  error: z.string().nullable(),
});

export const VisibilityResultSchema = z.object({
  providers: z.array(ProviderSchema),
  queries: z.array(BuyerQuerySchema),
  /** Respuestas obtenidas (sin contar las que fallaron). */
  total: z.number().int().min(0),
  citedIn: z.number().int().min(0),
  byProvider: z.partialRecord(ProviderSchema, z.object({ cited: z.number().int(), total: z.number().int() })),
  topCompetitors: z.array(z.object({ domain: z.string(), answers: z.number().int() })).max(3),
  answers: z.array(AnswerOutcomeSchema),
});

export const ReportTextSchema = z.object({
  model: z.string(),
  headline: z.string().nullable(),
  findings: z.array(z.string()).max(3),
  /** Frases descartadas por no citar un check o una consulta válidos. */
  dropped: z.array(z.string()),
});

export const ReportResultSchema = z.object({
  id: z.uuid(),
  domain: z.string(),
  createdAt: z.iso.datetime(),
  scan: ScanResultSchema,
  extraction: z.array(
    z.object({
      url: z.string(),
      data: z.object({
        name: z.string().nullable(),
        price: z.number().nullable(),
        currency: z.string().nullable(),
        availability: z.string().nullable(),
        gtin: z.string().nullable(),
        brand: z.string().nullable(),
      }).nullable(),
      truncated: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
  visibility: VisibilityResultSchema,
  report: ReportTextSchema,
  cost: z.object({
    totalUsd: z.number().min(0),
    totalEur: z.number().min(0),
    byPurpose: z.record(z.string(), z.object({ calls: z.number().int(), costUsd: z.number() })),
    llmCalls: z.number().int(),
    cachedCalls: z.number().int(),
  }),
  latencyMs: z.number().min(0),
});

export type BuyerQueryValue = z.infer<typeof BuyerQuerySchema>;
export type AnswerOutcome = z.infer<typeof AnswerOutcomeSchema>;
export type VisibilityResult = z.infer<typeof VisibilityResultSchema>;
export type ReportText = z.infer<typeof ReportTextSchema>;
export type ReportResult = z.infer<typeof ReportResultSchema>;

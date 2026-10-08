export const SCANNER_VERSION = "0.1.0";

/** Reglas de cortesía con las tiendas (CLAUDE.md). */
export const POLITENESS = {
  minIntervalMs: 1000,
  maxCrawlDelayMs: 10_000,
  maxRequestsPerDomain: 40,
  parallelDomains: 5,
  timeoutMs: 20_000,
  maxBodyBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
} as const;

/** Umbrales de los checks que el brief no fija; aprobados el 2026-10-08. */
export const THRESHOLDS = {
  /** A2: texto visible del rastreador frente al del navegador. */
  a2MinTextRatio: 0.7,
  /** B2: caracteres mínimos de descripción. */
  b2MinDescriptionChars: 300,
  /** E1: TTFB máximo en ms. */
  e1MaxTtfbMs: 800,
  productsPerDomain: 3,
} as const;

export const SCORE_CAP = 40;

/** Por debajo de esta cobertura (puntos evaluados / posibles) no se publica nota: sería poco representativa. */
export const MIN_COVERAGE = 0.5;

export const BANDS = [
  { min: 80, band: "preparada" },
  { min: 50, band: "legible con errores" },
  { min: 0, band: "ilegible" },
] as const;

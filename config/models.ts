// Modelos y precios de la capa LLM. Verificados el 2026-10-08 en:
// - https://developers.openai.com/api/docs/pricing y .../guides/tools-web-search
// - https://docs.perplexity.ai/docs/getting-started/pricing y .../agent-api/tools/web-search
// Gemini queda fuera hasta revisar los términos de Grounding with Google Search, que prohíben
// analizar o guardar los resultados citados (https://ai.google.dev/gemini-api/terms).

export const PROVIDERS = ["openai", "perplexity"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const MODELS = {
  /** Modelo Instant que usa ChatGPT (alias móvil). Si un informe pasa de 1 €, cambiar a `cheap`. */
  visibilityOpenAI: "chat-latest",
  /** Modelo propio de Perplexity en la Agent API (Sonar se retiró el 2026-09-27). */
  visibilityPerplexity: "perplexity/sonar",
  /** Consultas, extracción y detección de citas. */
  cheap: "gpt-6-luna",
  /** Titular y hallazgos. */
  report: "gpt-6.1-sol",
} as const;

export interface ModelPrice {
  /** USD por 1M de tokens. */
  input: number;
  cachedInput: number;
  output: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "chat-latest": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10 },
  "perplexity/sonar": { input: 0.25, cachedInput: 0.25, output: 2.5 },
};

/** USD por llamada a la herramienta de búsqueda. */
export const SEARCH_PRICES: Record<Provider, number> = {
  openai: 10 / 1000,
  perplexity: 2.5 / 1000,
};

/** Tipo de referencia del BCE del 2026-10-07: 1 EUR = 1,1177 USD. */
export const USD_TO_EUR = 1 / 1.1177;

export const LLM_LIMITS = {
  /** CLAUDE.md: detener si un informe supera 2 €. */
  maxEurPerReport: 2,
  /** Perplexity, nivel 0: 1 petición por segundo por organización. */
  perplexityMinIntervalMs: 1100,
  /** Llamadas simultáneas a OpenAI por informe. */
  openaiConcurrency: 4,
  timeoutMs: 120_000,
  /** Caracteres de HTML que se envían a extract.ts (≈ 30k tokens). */
  extractMaxChars: 120_000,
} as const;

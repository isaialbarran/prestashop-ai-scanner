import type { z } from "zod";
import type { Provider } from "../../config/models";

export type Purpose = "queries" | "visibility" | "detection" | "extraction" | "report";

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Llamadas a la herramienta de búsqueda (se cobran aparte). */
  searchCalls: number;
}

/** Una llamada a un LLM, tal como se registra en llm_calls. */
export interface LlmCall {
  id: string;
  purpose: Purpose;
  provider: Provider;
  model: string;
  /** sha256 de la petición: clave de la caché de desarrollo. */
  inputHash: string;
  startedAt: string;
  latencyMs: number;
  usage: Usage;
  costUsd: number;
  fromCache: boolean;
  error: string | null;
  /** Respuesta completa del proveedor (CLAUDE.md: guardar la respuesta completa). */
  response: unknown;
}

export interface Citation {
  url: string;
  title: string | null;
  domain: string;
}

/** Respuesta de un asistente con búsqueda web, normalizada entre proveedores. */
export interface SearchAnswer {
  provider: Provider;
  model: string;
  text: string;
  /** URLs que la respuesta cita. */
  cited: Citation[];
  /** URLs que el buscador consultó, citadas o no. */
  consulted: Citation[];
  searchQueries: string[];
  /** `markers`: Perplexity marcó las citas con [n]; `all-results`: no hubo marcas y se toman todos los resultados. */
  citationMode: "annotations" | "markers" | "all-results";
}

export interface StructuredRequest<T> {
  purpose: Exclude<Purpose, "visibility">;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  name: string;
}

export interface SearchRequest {
  provider: Provider;
  model: string;
  query: string;
}

/** Interfaz común para los proveedores reales y los dobles de los tests. */
export interface Llm {
  structured<T>(req: StructuredRequest<T>): Promise<{ data: T; call: LlmCall }>;
  search(req: SearchRequest): Promise<{ answer: SearchAnswer; call: LlmCall }>;
}

import { LLM_LIMITS } from "../config/models";
import { CostLedger } from "../src/llm/cost";
import { createLlmDiskCache, createLlmPool } from "../src/llm/live";
import type { Llm } from "../src/llm/types";

/** Llm para los evals: caché de desarrollo (repetir un eval sin cambios es gratis) y tope de 2 € por eval. */
export function evalLlm(): { llm: Llm; ledger: CostLedger } {
  const ledger = new CostLedger(LLM_LIMITS.maxEurPerReport);
  return { llm: createLlmPool({ cache: createLlmDiskCache() }).forLedger(ledger), ledger };
}

export function missing(file: string): never {
  throw new Error(`Falta ${file}. Pasos en evals/README.md`);
}

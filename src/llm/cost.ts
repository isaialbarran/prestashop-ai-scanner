import { PRICES, SEARCH_PRICES, USD_TO_EUR, type Provider } from "../../config/models";
import type { LlmCall, Purpose, Usage } from "./types";

export function costUsd(provider: Provider, model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) throw new Error(`Sin precio para el modelo ${model}: añádelo a config/models.ts`);
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const tokens =
    (uncached * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) / 1_000_000;
  return tokens + usage.searchCalls * SEARCH_PRICES[provider];
}

export const toEur = (usd: number) => usd * USD_TO_EUR;

export class BudgetExceededError extends Error {
  constructor(
    readonly spentEur: number,
    readonly limitEur: number,
  ) {
    super(`Presupuesto superado: ${spentEur.toFixed(3)} € de ${limitEur} €`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Registro de llamadas y gasto de un informe. Las respuestas de caché cuentan 0 € (no se pagan otra vez),
 * pero conservan su coste original en la llamada para los evals de coste.
 */
export class CostLedger {
  readonly calls: LlmCall[] = [];

  constructor(readonly limitEur: number) {}

  add(call: LlmCall): void {
    this.calls.push(call);
    const spent = this.spentEur();
    if (spent > this.limitEur) throw new BudgetExceededError(spent, this.limitEur);
  }

  /** Lo pagado en esta ejecución. */
  spentEur(): number {
    return toEur(this.calls.filter((c) => !c.fromCache).reduce((s, c) => s + c.costUsd, 0));
  }

  /** Lo que cuesta el informe aunque parte venga de caché: la cifra del eval de coste. */
  reportCostUsd(): number {
    return this.calls.reduce((s, c) => s + c.costUsd, 0);
  }

  byPurpose(): Record<Purpose, { calls: number; costUsd: number }> {
    const out = {} as Record<Purpose, { calls: number; costUsd: number }>;
    for (const c of this.calls) {
      out[c.purpose] ??= { calls: 0, costUsd: 0 };
      out[c.purpose].calls++;
      out[c.purpose].costUsd += c.costUsd;
    }
    return out;
  }
}

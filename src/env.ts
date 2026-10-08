import { z } from "zod";

const secret = z.string().trim().min(1);

export const envSchema = z.object({
  OPENAI_API_KEY: secret,
  GEMINI_API_KEY: secret,
  PERPLEXITY_API_KEY: secret,
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: secret,
  PAGESPEED_API_KEY: secret,
  MAX_BATCH_EUR: z.coerce.number().positive(),
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;
export const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/**
 * Valida solo las variables que necesita quien llama: la web solo usa Supabase,
 * el lote usa todas. Los mensajes de error nombran la variable, nunca su valor.
 */
export function loadEnv<K extends EnvKey>(
  keys: readonly K[],
  source: Record<string, string | undefined> = process.env,
): Pick<Env, K> {
  const values: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const key of keys) {
    const result = envSchema.shape[key].safeParse(source[key]);
    if (result.success) values[key] = result.data;
    else invalid.push(key);
  }
  if (invalid.length > 0) {
    throw new Error(`Variables de entorno ausentes o inválidas: ${invalid.join(", ")}`);
  }
  return values as Pick<Env, K>;
}

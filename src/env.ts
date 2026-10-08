import { z } from "zod";

const secret = z.string().trim().min(1);

// Los mensajes describen el formato esperado; nunca incluyen el valor.
export const envSchema = z.object({
  OPENAI_API_KEY: secret,
  GEMINI_API_KEY: secret,
  PERPLEXITY_API_KEY: secret,
  SUPABASE_URL: z.url({ message: "no es una URL" }),
  SUPABASE_SECRET_KEY: secret
    .refine((v) => !v.startsWith("sb_publishable_"), { message: "es la clave publicable; usa la secreta (sb_secret_…)" })
    .refine((v) => v.startsWith("sb_secret_") || v.startsWith("eyJ"), { message: "no parece una clave secreta de Supabase (sb_secret_…)" }),
  PAGESPEED_API_KEY: secret.refine((v) => /^AIza[0-9A-Za-z_-]{35}$/.test(v), {
    message: "no parece una clave de API de Google (AIza…, 39 caracteres)",
  }),
  MAX_BATCH_EUR: z.coerce.number({ message: "no es un número" }).positive({ message: "debe ser mayor que 0" }),
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;
export const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/** Motivo por el que una variable no es válida, o null si lo es. */
export function envProblem(key: EnvKey, source: Record<string, string | undefined> = process.env): string | null {
  if (!source[key]?.trim()) return "ausente";
  const result = envSchema.shape[key].safeParse(source[key]);
  return result.success ? null : (result.error.issues[0]?.message ?? "inválida");
}

/**
 * Valida solo las variables que necesita quien llama: la web solo usa Supabase,
 * el lote usa todas. Los mensajes de error nombran la variable, nunca su valor.
 */
export function loadEnv<K extends EnvKey>(
  keys: readonly K[],
  source: Record<string, string | undefined> = process.env,
): Pick<Env, K> {
  const problems = keys.map((key) => [key, envProblem(key, source)] as const).filter(([, p]) => p !== null);
  if (problems.length > 0) {
    throw new Error(`Variables de entorno ausentes o inválidas: ${problems.map(([k, p]) => `${k} (${p})`).join(", ")}`);
  }
  return Object.fromEntries(keys.map((key) => [key, envSchema.shape[key].parse(source[key])])) as Pick<Env, K>;
}

// Verifica el entorno: variables de .env.local presentes y válidas, Supabase accesible
// y claves de OpenAI y Perplexity aceptadas por su API. Nunca imprime valores de claves.
import { ENV_KEYS, envProblem, type EnvKey } from "../src/env";
import { createServerClient } from "../src/db/supabase";

// Gemini queda fuera hasta revisar los términos de Grounding with Google Search (config/models.ts).
const UNUSED: readonly EnvKey[] = ["GEMINI_API_KEY"];

let ok = true;

for (const key of ENV_KEYS) {
  const problem = envProblem(key);
  if (UNUSED.includes(key)) {
    console.log(`· ${key} no se usa (Gemini fuera hasta revisar sus términos)`);
  } else if (!problem) {
    console.log(`✓ ${key}`);
  } else {
    ok = false;
    console.log(`✗ ${key}: ${problem}`);
  }
}

try {
  // listUsers exige la clave secreta: valida a la vez URL y clave.
  const { error } = await createServerClient().auth.admin.listUsers({ perPage: 1 });
  if (error) throw error;
  console.log("✓ Supabase responde con la clave secreta");
} catch (err) {
  ok = false;
  console.log(`✗ Supabase: ${err instanceof Error ? err.message : String(err)}`);
}

// Listar modelos es gratis y confirma que cada clave es de su proveedor.
for (const [name, key, url] of [
  ["OpenAI", "OPENAI_API_KEY", "https://api.openai.com/v1/models"],
  ["Perplexity", "PERPLEXITY_API_KEY", "https://api.perplexity.ai/v1/models"],
] as const) {
  if (envProblem(key)) continue;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${process.env[key]!.trim()}` }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      console.log(`✓ ${name} acepta la clave`);
    } else {
      ok = false;
      console.log(`✗ ${name} rechaza la clave (${res.status})`);
    }
  } catch (err) {
    ok = false;
    console.log(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

process.exit(ok ? 0 : 1);

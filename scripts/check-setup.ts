// Verifica la fase 0: variables de .env.local presentes y Supabase accesible.
// Nunca imprime valores de claves.
import { ENV_KEYS, loadEnv, type EnvKey } from "../src/env";
import { createServerClient } from "../src/db/supabase";

// Claves de los proveedores LLM: no bloquean hasta la fase 2.
const PHASE_2_KEYS: readonly EnvKey[] = ["OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"];

let ok = true;

for (const key of ENV_KEYS) {
  try {
    loadEnv([key]);
    console.log(`✓ ${key}`);
  } catch {
    if (PHASE_2_KEYS.includes(key)) {
      console.log(`· ${key} pendiente (fase 2)`);
    } else {
      ok = false;
      console.log(`✗ ${key} ausente o inválida`);
    }
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

process.exit(ok ? 0 : 1);

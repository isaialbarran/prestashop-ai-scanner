import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../env";

/** Cliente con la clave secreta: solo para scripts y código de servidor. */
export function createServerClient(): SupabaseClient {
  const env = loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

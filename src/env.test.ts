import { describe, expect, it } from "vitest";
import { envProblem, loadEnv } from "./env";

const full = {
  OPENAI_API_KEY: "sk-test",
  GEMINI_API_KEY: "gm-test",
  PERPLEXITY_API_KEY: "pplx-test",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  PAGESPEED_API_KEY: "AIzaSyA-1234567890abcdefghijklmnopqrstu",
  MAX_BATCH_EUR: "50",
};

describe("loadEnv", () => {
  it("devuelve solo las claves pedidas", () => {
    const env = loadEnv(["SUPABASE_URL", "SUPABASE_SECRET_KEY"], full);
    expect(env).toEqual({
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    });
  });

  it("convierte MAX_BATCH_EUR a número", () => {
    expect(loadEnv(["MAX_BATCH_EUR"], full).MAX_BATCH_EUR).toBe(50);
  });

  it("ignora variables que no se piden aunque falten", () => {
    expect(() => loadEnv(["SUPABASE_URL"], { SUPABASE_URL: full.SUPABASE_URL })).not.toThrow();
  });

  it("nombra las variables ausentes o inválidas con el motivo, sin mostrar valores", () => {
    const call = () =>
      loadEnv(["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"], {
        OPENAI_API_KEY: "  ",
        SUPABASE_URL: "no-es-una-url",
        SUPABASE_SECRET_KEY: "sb_secret_test",
      });
    expect(call).toThrow(/OPENAI_API_KEY \(ausente\), SUPABASE_URL \(no es una URL\)$/);
    expect(call).not.toThrow(/sb_secret_test|no-es-una-url/);
  });

  it("rechaza un presupuesto no positivo", () => {
    expect(() => loadEnv(["MAX_BATCH_EUR"], { MAX_BATCH_EUR: "0" })).toThrow(/MAX_BATCH_EUR/);
  });
});

describe("envProblem", () => {
  it("detecta la clave publicable de Supabase puesta como secreta", () => {
    expect(envProblem("SUPABASE_SECRET_KEY", { SUPABASE_SECRET_KEY: "sb_publishable_x" })).toMatch(/publicable/);
  });

  it("acepta la clave secreta nueva y el JWT legacy", () => {
    expect(envProblem("SUPABASE_SECRET_KEY", { SUPABASE_SECRET_KEY: "sb_secret_x" })).toBeNull();
    expect(envProblem("SUPABASE_SECRET_KEY", { SUPABASE_SECRET_KEY: "eyJhbGciOi" })).toBeNull();
  });

  it("detecta una clave que no es de Google en PAGESPEED_API_KEY", () => {
    expect(envProblem("PAGESPEED_API_KEY", { PAGESPEED_API_KEY: "sb_secret_x" })).toMatch(/Google/);
    expect(envProblem("PAGESPEED_API_KEY", full)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const full = {
  OPENAI_API_KEY: "sk-test",
  GEMINI_API_KEY: "gm-test",
  PERPLEXITY_API_KEY: "pplx-test",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  PAGESPEED_API_KEY: "ps-test",
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

  it("nombra las variables ausentes o vacías sin mostrar valores", () => {
    const call = () =>
      loadEnv(["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"], {
        OPENAI_API_KEY: "  ",
        SUPABASE_URL: "no-es-una-url",
        SUPABASE_SECRET_KEY: "sb_secret_test",
      });
    expect(call).toThrow(/OPENAI_API_KEY, SUPABASE_URL$/);
    expect(call).not.toThrow(/sb_secret_test|no-es-una-url/);
  });

  it("rechaza un presupuesto no positivo", () => {
    expect(() => loadEnv(["MAX_BATCH_EUR"], { MAX_BATCH_EUR: "0" })).toThrow(/MAX_BATCH_EUR/);
  });
});

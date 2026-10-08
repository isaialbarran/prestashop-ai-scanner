import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Los evals de extracción y detección llaman a la API (con caché): necesitan las claves de .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    globalSetup: ["evals/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    environment: "node",
  },
});

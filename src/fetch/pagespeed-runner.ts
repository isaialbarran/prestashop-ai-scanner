import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../env";
import { fetchPageSpeed, type PageSpeedResult } from "./pagespeed";

/**
 * PageSpeed Insights con caché de desarrollo; null (y aviso) si falta PAGESPEED_API_KEY.
 * `readCache: false` es el modo en frío: pide de nuevo pero guarda el resultado, como las otras cachés.
 */
export function pageSpeedRunner(readCache: boolean): ((url: string) => Promise<PageSpeedResult>) | null {
  let key: string;
  try {
    key = loadEnv(["PAGESPEED_API_KEY"]).PAGESPEED_API_KEY;
  } catch {
    console.warn("Sin PAGESPEED_API_KEY: E2 quedará inconcluso.");
    return null;
  }
  const dir = path.join(process.cwd(), ".cache", "pagespeed");
  return async (url) => {
    const file = path.join(dir, `${createHash("sha256").update(url).digest("hex")}.json`);
    if (readCache) {
      const hit = await readFile(file, "utf8").then(JSON.parse, () => null);
      if (hit) return hit as PageSpeedResult;
    }
    const result = await fetchPageSpeed(url, key);
    if (!result.error) {
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(result));
    }
    return result;
  };
}
